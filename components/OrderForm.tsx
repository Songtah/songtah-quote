'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Fuse from 'fuse.js'
import type { OrderItem, ItemType } from '@/lib/orders-notion'
import type { PromotionItem } from '@/lib/promotion-items-notion'
import { matchPromoRule, buyNGetMGiftQty, SERIES_CONDITION_TYPES } from '@/lib/order-pricing'
import { ProductFamily, YMHToothGridPanel, FamilySpecPanel } from '@/components/FamilySpecPicker'
import { allowedOrderTransitions, ORDER_STATUS_STYLE, PAYMENT_METHOD_PRESETS, DELIVERY_METHOD_PRESETS, type OrderActor } from '@/lib/order-status'
import { rocDate } from '@/lib/quote-model'

/** 欄位外框（放在元件外：定義在 render 內會每次重建，輸入框打一個字就失去焦點） */
function Field({ label, children, className = '', hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline gap-1.5 text-xs font-medium text-stone-500">{label}{hint && <span className="font-normal text-stone-400">{hint}</span>}</span>
      {children}
    </label>
  )
}

interface ActivePromotion { id: string; name: string; type: string; startDate: string; endDate: string }

// Inline to avoid importing server-side Notion client in the browser bundle
const calcTotal = (items: OrderItem[]): number =>
  items.reduce((sum, it) => {
    if (it.itemType === 'gift' || it.itemType === 'sample') return sum
    return sum + it.quantity * (it.unitPrice || 0)
  }, 0)

const ITEM_TYPE_LABEL: Record<ItemType, string>  = { normal: '一般', gift: '贈品', sample: '樣品' }
const ITEM_TYPE_COLOR: Record<ItemType, string>  = {
  normal: 'bg-stone-100 text-stone-600',
  gift:   'bg-emerald-50 text-emerald-700',
  sample: 'bg-gold-50 text-gold-700',
}

// ── 產品目錄型別 (對應 /api/products/search + /api/products/families) ──

interface CatalogItem {
  id: string
  name: string
  manufacturer: string
  productType: string
  category: string
  skuCode: string
  price: number | null
  salePrice: number | null
  notes: string
}

interface ManualFamilyMember {
  code: string
  name: string
  brand: string
}

function ManualFamilyItems({
  family,
  priceMap,
  onAdd,
  allowedSkuCodes,
}: {
  family: ProductFamily
  priceMap: Record<string, { p: number; s?: number }>
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
  allowedSkuCodes?: string[]
}) {
  const [members, setMembers] = useState<ManualFamilyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch(`/api/products/families/${encodeURIComponent(family.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((data) => {
        if (!active) return
        const rows = Array.isArray(data.members) ? data.members : []
        const allowed = allowedSkuCodes ? new Set(allowedSkuCodes) : null
        setMembers(allowed ? rows.filter((member: ManualFamilyMember) => allowed.has(member.code)) : rows)
      })
      .catch(() => { if (active) setError('系列品項暫時無法讀取') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowedSkuCodes, family.id])

  if (loading) return <p className="px-5 py-4 text-sm text-stone-400">載入系列品項…</p>
  if (error) return <p className="px-5 py-4 text-sm text-red-600" role="alert">{error}</p>

  return (
    <div className="space-y-1 bg-stone-50/60 px-3 py-2 sm:px-5">
      {members.map((member) => (
        <button
          key={member.code}
          type="button"
          onClick={() => onAdd({
            skuCode: member.code,
            skuName: member.name,
            brand: member.brand || family.brand,
            seriesName: family.seriesName,
            seriesId: family.id,
            unitPrice: priceMap[member.code]?.s ?? priceMap[member.code]?.p ?? 0,
          })}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white px-3 py-2 text-left transition-all hover:bg-brand-50 active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-stone-700">{member.name}</span>
            <span className="font-mono text-[11px] text-stone-400">{member.code}</span>
          </span>
          <span className="text-xs font-semibold text-brand-600">加入</span>
        </button>
      ))}
      {members.length === 0 && <p className="py-4 text-center text-sm text-stone-400">此系列尚無品項</p>}
    </div>
  )
}

// ── ProductPicker ─────────────────────────────────────────────

function ProductPicker({
  onAdd,
  onClose,
  lockSeriesId,
  lockSeriesName,
}: {
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
  onClose: () => void
  lockSeriesId?: string      // 鎖定只顯示此系列（選贈品用）
  lockSeriesName?: string
}) {
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [families, setFamilies] = useState<ProductFamily[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [allBrands, setAllBrands] = useState<string[]>([])
  const [allTypes, setAllTypes] = useState<string[]>([])
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [browseItems, setBrowseItems] = useState<CatalogItem[]>([])
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null)
  const [notionAssignedCodes, setNotionAssignedCodes] = useState<Set<string>>(new Set())
  const [priceMap, setPriceMap] = useState<Record<string, { p: number; s?: number }>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同時載入規格系列 + 完整目錄的篩選選項（44 品牌、7 類型）
  useEffect(() => {
    fetch('/api/products/families')
      .then((r) => r.json())
      .then((data) => { setFamilies(data); setFamiliesLoading(false) })
      .catch(() => setFamiliesLoading(false))

    // 主檔價格對照表（系列矩陣選品帶入單價用）
    fetch('/api/products/prices')
      .then((r) => r.json())
      .then((data) => { if (data && typeof data === 'object') setPriceMap(data) })
      .catch(() => {})

    fetch('/api/products/options')
      .then((r) => r.json())
      .then((data) => {
        if (data.brands) setAllBrands(data.brands)
        if (data.productTypes) setAllTypes(data.productTypes)
        if (data.categories) setAllCategories(data.categories)
      })
      .catch(() => {})

    fetch('/api/products/notion-assignments')
      .then((r) => r.json())
      .then((data: { skuCodes: string[] }) => setNotionAssignedCodes(new Set(data.skuCodes)))
      .catch(() => {})
  }, [])

  // 防抖搜尋：只有輸入文字關鍵字時才送 API（品牌 / 類型篩選由瀏覽模式 Accordion 處理）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = search.trim()
    if (!q) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '80' })
        params.set('q', q)
        if (filterBrand) params.set('brand', filterBrand)
        if (filterType) params.set('type', filterType)
        if (filterCategory) params.set('category', filterCategory)
        const res = await fetch(`/api/products/search?${params}`)
        if (res.ok) setSearchResults(await res.json())
      } catch { /* ignore */ } finally { setSearchLoading(false) }
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search, filterBrand, filterType, filterCategory])

  const isSearching = !lockSeriesId && search.trim().length > 0

  // 鎖定系列：載入後自動展開該系列規格表
  useEffect(() => {
    if (lockSeriesId && families.length > 0) setExpandedFamilyId(lockSeriesId)
  }, [lockSeriesId, families])

  // 瀏覽模式：依品牌 / 類型篩選系列
  const filteredFamilies = useMemo(() => {
    if (lockSeriesId) return families.filter((f) => f.id === lockSeriesId)
    if (!filterBrand && !filterType && !filterCategory) return families
    return families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      if (filterCategory && f.category !== filterCategory) return false
      return true
    })
  }, [families, filterBrand, filterType, filterCategory, lockSeriesId])

  // 搜尋模式：以關鍵字比對系列名稱 / 品牌 / 分類，同時套用 brand/type 篩選
  const familySearchResults = useMemo(() => {
    if (!search.trim()) return []
    const kw = search.normalize('NFKC').trim().toLowerCase()
    const candidates = families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      if (filterCategory && f.category !== filterCategory) return false
      return true
    })
    const tokens = kw.split(/[\s\-_/.,，。()（）]+/).filter(Boolean)
    const exact = candidates.filter((family) => {
      const text = [family.seriesCode, family.seriesName, family.brand, family.category, family.productType]
        .join(' ')
        .normalize('NFKC')
        .toLowerCase()
      return tokens.every((token) => text.includes(token))
    })
    const exactIds = new Set(exact.map((family) => family.id))
    const fuzzy = new Fuse(candidates, {
      keys: [
        { name: 'seriesCode', weight: 0.32 },
        { name: 'seriesName', weight: 0.32 },
        { name: 'brand', weight: 0.14 },
        { name: 'category', weight: 0.12 },
        { name: 'productType', weight: 0.1 },
      ],
      threshold: 0.38,
      distance: 100,
      ignoreLocation: true,
      minMatchCharLength: 2,
    }).search(kw).map((result) => result.item)
    return [...exact, ...fuzzy.filter((family) => !exactIds.has(family.id))]
  }, [families, search, filterBrand, filterType, filterCategory])

  // 所有已被規格系列涵蓋的貨品碼（skuMap 中的 value），用於過濾搜尋結果
  const coveredSkuCodes = useMemo(() => {
    const s = new Set<string>()
    families.forEach((f) => {
      if (f.skuMap) Object.values(f.skuMap).forEach((code) => s.add(code))
    })
    notionAssignedCodes.forEach((code) => s.add(code))
    return s
  }, [families, notionAssignedCodes])

  // 搜尋模式：去除已有規格系列涵蓋的品項，避免重複顯示
  const remainingSearchResults = useMemo(
    () => searchResults.filter((item) => !coveredSkuCodes.has(item.skuCode)),
    [searchResults, coveredSkuCodes]
  )

  // 瀏覽模式 fallback：當篩選條件有效但沒有符合的規格系列時，直接從目錄 API 拉個別品項
  useEffect(() => {
    if (isSearching) { setBrowseItems([]); return }
    if (!filterBrand && !filterType && !filterCategory) { setBrowseItems([]); return }
    const params = new URLSearchParams({ limit: '200' })
    if (filterBrand) params.set('brand', filterBrand)
    if (filterType)  params.set('type', filterType)
    if (filterCategory) params.set('category', filterCategory)
    fetch(`/api/products/search?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((items: CatalogItem[]) => {
        setBrowseItems(items.filter((it) => !coveredSkuCodes.has(it.skuCode)))
      })
      .catch(() => setBrowseItems([]))
  }, [isSearching, filterBrand, filterType, filterCategory, coveredSkuCodes])

  const handleAddItem = useCallback(
    (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => onAdd(item),
    [onAdd]
  )

  const handleAddCatalogItem = useCallback(
    (item: CatalogItem) => {
      onAdd({
        skuCode:    item.skuCode,
        skuName:    item.name,
        brand:      item.manufacturer,
        seriesName: item.category,
        seriesId:   '',
        // 優先用促銷特價，fallback 到資料庫售價 → 定價 → 0
        unitPrice: item.salePrice ?? item.price ?? 0,
      })
    },
    [onAdd]
  )

  const toggleFamily = useCallback((id: string) => {
    setExpandedFamilyId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-2xl bg-[#fdfdfb] rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-900/[0.06]">
          <h2 className="text-base font-bold text-stone-800 tracking-wide">
            {lockSeriesName ? `🎁 選擇贈品：${lockSeriesName}` : '選擇品項'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        {!lockSeriesId && (
        <div className="px-5 py-3.5 border-b border-stone-900/[0.06] space-y-2.5 bg-white/60">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedFamilyId(null) }}
            placeholder="搜尋品名、貨號、系列、規格；可輸入部分文字…"
            className="input-soft"
            autoFocus
          />
          <div className="flex gap-2">
            <select
              value={filterBrand}
              onChange={(e) => { setFilterBrand(e.target.value); setExpandedFamilyId(null) }}
              className="select-soft flex-1 min-w-0"
            >
              <option value="">全部品牌</option>
              {allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setExpandedFamilyId(null) }}
              className="select-soft flex-1 min-w-0"
            >
              <option value="">全部類型</option>
              {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setExpandedFamilyId(null) }}
              className="select-soft flex-1 min-w-0"
            >
              <option value="">全部分類</option>
              {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            /* ── 搜尋模式：規格系列優先，再顯示其餘個別品項 ── */
            searchLoading ? (
              <div className="text-center text-stone-400 py-12 text-sm animate-pulse">搜尋中...</div>
            ) : familySearchResults.length === 0 && remainingSearchResults.length === 0 ? (
              <div className="text-center text-stone-400 py-12 text-sm">無符合品項</div>
            ) : (
              <div className="divide-y divide-stone-900/[0.05]">
                {/* ① 符合的規格系列 */}
                {familySearchResults.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50 text-left transition-colors group"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-stone-300 group-hover:text-brand-500 text-xs w-4 shrink-0 transition-colors">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-stone-800">{family.seriesName}</div>
                          <div className="text-xs text-stone-400 flex flex-wrap gap-1.5">
                            <span>{family.brand}</span>
                            <span>·</span>
                            <span>{family.productType}</span>
                            {family.specs.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-brand-500">
                                  {family.specs.map((s) => s.label).join(' × ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <>
                          {family.uiVariant === 'ymh-tooth-grid'
                            ? <YMHToothGridPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: priceMap[code]?.s ?? priceMap[code]?.p ?? 0 })}
                            />
                            : family.specs.length > 0 ? <FamilySpecPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: priceMap[code]?.s ?? priceMap[code]?.p ?? 0 })}
                            />
                            : <ManualFamilyItems family={family} priceMap={priceMap} onAdd={handleAddItem} />}
                          {family.specs.length > 0 && (family.manualAssignedSkuCodes?.length ?? 0) > 0 && (
                            <ManualFamilyItems family={family} priceMap={priceMap} onAdd={handleAddItem} allowedSkuCodes={family.manualAssignedSkuCodes} />
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                {/* ② 其餘不屬於任何規格系列的個別品項 */}
                {remainingSearchResults.length > 0 && (
                  <>
                    {familySearchResults.length > 0 && (
                      <div className="px-5 py-2 bg-stone-100/70 text-[11px] font-bold uppercase tracking-widest text-stone-400">
                        其他品項
                      </div>
                    )}
                    {remainingSearchResults.map((item) => (
                      <div
                        key={item.skuCode}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50 transition-colors group/item"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-stone-800 truncate">{item.name}</div>
                          <div className="text-xs text-stone-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-sm font-semibold px-3.5 py-1.5 rounded-full border border-brand-200 text-brand-700 bg-white hover:bg-brand-500 hover:text-white hover:border-brand-500 active:scale-95 transition-all"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                    {remainingSearchResults.length >= 80 && (
                      <div className="text-center text-xs text-stone-400 py-3 bg-stone-50">
                        顯示前 80 筆，請輸入更精確的關鍵字
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          ) : (
            /* ── 瀏覽模式：規格系列 Accordion ── */
            familiesLoading ? (
              <div className="text-center text-stone-400 py-12 text-sm animate-pulse">載入中...</div>
            ) : filteredFamilies.length === 0 ? (
              browseItems.length > 0 ? (
                <div className="divide-y divide-stone-900/[0.05]">
                  {browseItems.map((item) => (
                    <div key={item.skuCode} className="flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50 transition-colors group/item">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-stone-800 truncate">{item.name}</div>
                        <div className="text-xs text-stone-400 flex gap-2 flex-wrap">
                          <span className="font-mono">{item.skuCode}</span>
                          <span>{item.manufacturer} · {item.category}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddCatalogItem(item)}
                        className="shrink-0 text-sm font-semibold px-3.5 py-1.5 rounded-full border border-brand-200 text-brand-700 bg-white hover:bg-brand-500 hover:text-white hover:border-brand-500 active:scale-95 transition-all"
                      >
                        + 加入
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-stone-400 py-12 text-sm">沒有符合條件的品項</div>
              )
            ) : (
              <div className="divide-y divide-stone-900/[0.05]">
                {filteredFamilies.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50 text-left transition-colors group"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-stone-300 group-hover:text-brand-500 text-xs w-4 shrink-0 transition-colors">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-stone-800">{family.seriesName}</div>
                          <div className="text-xs text-stone-400 flex flex-wrap gap-1.5">
                            <span>{family.brand}</span>
                            <span>·</span>
                            <span>{family.productType}</span>
                            {family.specs.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-brand-500">
                                  {family.specs.map((s) => s.label).join(' × ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <>
                          {family.uiVariant === 'ymh-tooth-grid'
                            ? <YMHToothGridPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: priceMap[code]?.s ?? priceMap[code]?.p ?? 0 })}
                            />
                            : family.specs.length > 0 ? <FamilySpecPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: priceMap[code]?.s ?? priceMap[code]?.p ?? 0 })}
                            />
                            : <ManualFamilyItems family={family} priceMap={priceMap} onAdd={handleAddItem} />}
                          {family.specs.length > 0 && (family.manualAssignedSkuCodes?.length ?? 0) > 0 && (
                            <ManualFamilyItems family={family} priceMap={priceMap} onAdd={handleAddItem} allowedSkuCodes={family.manualAssignedSkuCodes} />
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                {/* 篩選模式下，屬於該品牌/類型但不在規格系列中的個別品項 */}
                {browseItems.length > 0 && (
                  <>
                    <div className="px-5 py-2 bg-stone-100/70 text-[11px] font-bold uppercase tracking-widest text-stone-400">
                      其他品項
                    </div>
                    {browseItems.map((item) => (
                      <div key={item.skuCode} className="flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50 transition-colors group/item">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-stone-800 truncate">{item.name}</div>
                          <div className="text-xs text-stone-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-sm font-semibold px-3.5 py-1.5 rounded-full border border-brand-200 text-brand-700 bg-white hover:bg-brand-500 hover:text-white hover:border-brand-500 active:scale-95 transition-all"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {/* 提示：規格系列以外的品項請搜尋 */}
                {!filterBrand && !filterType && !filterCategory && (
                <div className="px-4 py-3 bg-cream-100 border-t border-cream-300">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    💡 以上為含規格選項的系列。其餘 <span className="font-semibold">6,037 筆</span> 商品請在上方搜尋欄輸入品名或貨品碼，或選擇品牌 / 類型 / 分類篩選。
                  </p>
                </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t rounded-b-2xl text-xs text-stone-400 text-center bg-stone-50">
          {isSearching
            ? `${familySearchResults.length} 個系列・${remainingSearchResults.length} 筆其他品項`
            : browseItems.length > 0
              ? `${filteredFamilies.length} 個規格系列・${browseItems.length} 筆其他品項`
              : `${filteredFamilies.length} 個規格系列 · 搜尋可找到全部 6,037 筆`}
        </div>
      </motion.div>
    </div>
  )
}

// ── CustomerSearchBox ─────────────────────────────────────────
// 單一文字欄位：直接打字即為客戶名稱；同時即時搜尋 CRM，選取後自動填入其他欄位

interface CustomerResult {
  id: string
  name: string
  city: string
  address: string
}

interface SelectedCustomer {
  id: string
  name: string
  companyTitle: string
  address: string
  phone: string
  contactPerson: string
  taxId: string
}

function CustomerNameInput({
  customer,
  onChange,
  disabled,
}: {
  customer: SelectedCustomer
  onChange: (c: SelectedCustomer) => void
  disabled?: boolean
}) {
  const [results, setResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const timerRef = useState<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useState<HTMLDivElement | null>(null)

  // Debounced CRM search
  const handleNameChange = (val: string) => {
    onChange({ ...customer, name: val, id: '' })
    if (timerRef[0]) clearTimeout(timerRef[0])
    if (!val.trim()) { setResults([]); setOpen(false); return }
    timerRef[0] = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(val)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data)
          setOpen(data.length > 0)
        }
      } catch { /* ignore */ } finally { setSearching(false) }
    }, 300)
  }

  // Click-outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef[0] && !wrapRef[0].contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapRef[0]])

  const handleSelect = async (c: CustomerResult) => {
    setOpen(false)
    setResults([])
    try {
      const res = await fetch(`/api/customers/${c.id}`)
      if (res.ok) {
        const data = await res.json()
        const d = data.customer
        onChange({
          id: c.id,
          name: d?.name ?? c.name,
          companyTitle: customer.companyTitle,
          address: d?.address ?? c.address,
          phone: d?.phone ?? '',
          contactPerson: customer.contactPerson,
          taxId: d?.taxId ?? '',
        })
        return
      }
    } catch { /* fallback */ }
    onChange({ ...customer, id: c.id, name: c.name, address: c.address })
  }

  return (
    <div className="relative" ref={(el) => { wrapRef[0] = el }}>
      <div className="relative">
        <input
          type="text"
          value={customer.name}
          onChange={(e) => handleNameChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="輸入客戶 / 診所名稱（可直接填寫，或由 CRM 選取）"
          disabled={disabled}
          className="input-soft w-full px-4 py-2.5 text-sm disabled:bg-stone-50 disabled:text-stone-500 pr-16"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 animate-pulse">搜尋中…</span>
        )}
        {!searching && customer.id && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-600">✓ 已連結</span>
        )}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border rounded-xl shadow-xl overflow-hidden"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {results.map((c) => (
              <button
                key={c.id}
                onMouseDown={() => handleSelect(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-brand-50 border-b last:border-0 transition-colors"
              >
                <div className="text-sm font-medium text-stone-800">{c.name}</div>
                {(c.city || c.address) && (
                  <div className="text-xs text-stone-400 mt-0.5">{c.city}{c.address ? ` · ${c.address}` : ''}</div>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Promotion condition helpers ───────────────────────────────

// 計算/比對邏輯改用共用引擎 lib/order-pricing（與後端促銷驗證同一份真實來源，避免飄移）。
// 以下為薄委派，保留原名稱與型別以免呼叫端變動。
const calcBuyNGetMGiftQty = buyNGetMGiftQty

function matchPromoItem(
  item: { skuCode?: string; seriesId?: string },
  promoItems: PromotionItem[]
): PromotionItem | undefined {
  return matchPromoRule(item, promoItems) as PromotionItem | undefined
}

/**
 * 對新加入的品項套用促銷條件，回傳：
 * - patches:   直接修改 newItem 的欄位（自動）
 * - giftRows:  需要額外插入的贈品列（buy_a_get_b）
 * - hintLabel: 顯示在品項列上的提示文字（半自動 / 資訊型）
 */
function applyPromoCondition(newItem: OrderItem, promoItem: PromotionItem): {
  patches:   Partial<OrderItem>
  giftRows:  OrderItem[]
  hintLabel: string | null
} {
  const p = promoItem.conditionParams as any
  const patches:  Partial<OrderItem> = {}
  const giftRows: OrderItem[]        = []
  let   hintLabel: string | null     = null

  switch (promoItem.conditionType) {

    // ── 全自動：直接帶價 ──────────────────────────────────────
    case 'single_price':
      if (p?.price != null) {
        patches.unitPrice = p.price
        hintLabel = `促銷價 NT$${Number(p.price).toLocaleString()}`
      }
      break

    case 'add_on':
      if (p?.addOnPrice != null) {
        patches.unitPrice = p.addOnPrice
        hintLabel = `加購價 NT$${Number(p.addOnPrice).toLocaleString()}`
      }
      break

    case 'fixed_set_price': {
      // 初次加入（qty=1）先找是否剛好有 1件 tier；之後靠 handleQtyChange 更新
      const tier = (p?.tiers ?? []).find((t: any) => t.qty === 1)
      if (tier) patches.unitPrice = Math.round(tier.totalPrice / tier.qty)
      // 顯示全部方案供業務參考
      if ((p?.tiers ?? []).length > 0) {
        hintLabel = (p.tiers as { qty: number; totalPrice: number }[])
          .map((t) => `${t.qty}件 NT$${t.totalPrice.toLocaleString()}`)
          .join(' / ')
      }
      break
    }

    // ── 自動插入贈品列 ────────────────────────────────────────
    case 'buy_a_get_b':
      if (p?.giftSkuCode) {
        giftRows.push({
          id:         `gift-${Date.now()}-${Math.random()}`,
          skuCode:    p.giftSkuCode,
          skuName:    p.giftSkuName ?? p.giftSkuCode,
          brand:      '',
          seriesName: '',
          seriesId:   '',
          quantity:   p.giftQty ?? 1,
          unitPrice:  0,
          itemType:   'gift',
          note:       '[促銷贈品]',
        } as OrderItem)
        hintLabel = `買→贈 ${p.giftSkuName ?? p.giftSkuCode}`
      }
      break

    // ── 半自動：顯示提示，數量聯動由 handleQtyChange 接手 ───
    case 'buy_n_get_m':
      if (p?.n && p?.m) hintLabel = `買${p.n}送${p.m}（數量足時自動補贈品）`
      break

    case 'series_buy_n_get_m':
      // 僅顯示靜態提示；進度由 SeriesPromoBanner 動態計算
      if (p?.n && p?.m) hintLabel = `系列買${p.n}送${p.m}（詳見上方進度條）`
      break

    case 'series_discount':
      if (p?.rate != null) {
        if (newItem.unitPrice > 0) {
          // 有原價 → 直接算折後價
          patches.baseUnitPrice = newItem.unitPrice
          patches.unitPrice     = Math.round(newItem.unitPrice * p.rate)
          hintLabel = `全系列${Math.round(p.rate * 10)}折 → NT$${patches.unitPrice.toLocaleString()}`
        } else {
          hintLabel = `全系列 ${Math.round(p.rate * 10)}折（請確認定價）`
        }
      }
      break

    case 'qty_discount': {
      const tiers = (p?.tiers ?? []) as { minQty: number; rate?: number; price?: number }[]
      if (tiers.length > 0) {
        // 加入時 qty=1，找最高滿足的 tier 先帶入
        const firstTier = tiers.filter((t) => 1 >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0]
        if (firstTier?.price != null) {
          patches.unitPrice = firstTier.price
        } else if (firstTier?.rate != null && newItem.unitPrice > 0) {
          patches.baseUnitPrice = newItem.unitPrice
          patches.unitPrice     = Math.round(newItem.unitPrice * firstTier.rate)
        }
        hintLabel = tiers
          .map((t) => `滿${t.minQty}件 ${t.rate != null ? Math.round(t.rate * 10) + '折' : 'NT$' + t.price}`)
          .join(' / ')
      }
      break
    }

    case 'bundle':
      hintLabel = p?.partnerSkuName ? `搭配 ${p.partnerSkuName} 可享組合優惠` : '商品組合優惠'
      break

  }

  return { patches, giftRows, hintLabel }
}

// ── OrderForm (主元件) ────────────────────────────────────────

interface OrderFormProps {
  initialOrder?: {
    id: string
    orderNumber: string
    date: string
    salesperson: string
    status: string
    note: string
    items: OrderItem[]
    customerId?: string
    customerName?: string
    companyTitle?: string
    customerAddress?: string
    customerPhone?: string
    contactPerson?: string
    customerTaxId?: string
    promotionId?:   string
    promotionName?: string
    requestedDate?:  string
    paymentMethod?:  string
    deliveryMethod?: string
  }
  canEdit?: boolean
  /** staff＝行政（可確認、到貨、改非草稿單）；editor＝業務（只能改草稿） */
  actor?: OrderActor
  /** 新單預設的業務承辦（登入者） */
  defaultSalesperson?: string
  /** 鎖定原因說明（傳入時覆蓋預設的「僅限閱覽」文字） */
  lockedNote?: string
  /**
   * 新增模式下的預填資料（例如從已核准報價單「轉訂單」帶入客戶與備註）。
   * 與 initialOrder 不同：不會觸發編輯模式（isEdit 仍為 false，送出仍是 POST 新建)。
   */
  prefill?: {
    customerId?: string
    customerName?: string
    companyTitle?: string
    customerAddress?: string
    customerPhone?: string
    contactPerson?: string
    customerTaxId?: string
    note?: string
    paymentMethod?: string
    deliveryMethod?: string
    /** 「再訂一次」：已由伺服器套用當下有效售價、排除停售品與贈品 */
    items?: OrderItem[]
  }
}

export default function OrderForm({ initialOrder, canEdit = true, lockedNote, prefill, actor = 'editor', defaultSalesperson = '' }: OrderFormProps) {
  const router = useRouter()
  const isEdit = !!initialOrder

  // Form state
  // 日期初始值在 useEffect 設定，避免 Server/Client 時間不同導致 Hydration Mismatch
  const [date, setDate] = useState(initialOrder?.date ?? '')
  useEffect(() => {
    if (!date) {
      setDate(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [salesperson, setSalesperson] = useState(initialOrder?.salesperson ?? defaultSalesperson)
  const [salespersonOptions, setSalespersonOptions] = useState<string[]>([])
  const [note, setNote] = useState(initialOrder?.note ?? prefill?.note ?? '')
  const [status, setStatus] = useState<string>(initialOrder?.status ?? '草稿')
  const [items, setItems] = useState<OrderItem[]>(initialOrder?.items ?? prefill?.items ?? [])
  const [showPicker, setShowPicker] = useState(false)
  // 跨規格系列買N送M：開啟「選贈品」用的選品器（鎖定該系列）
  const [giftPicker, setGiftPicker] = useState<{ seriesId: string; seriesName: string } | null>(null)
  // 已自動跳出過選贈品的系列（避免重複自動彈出）
  const autoGiftPromptedRef = useRef<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Promotion
  const [promotionId,   setPromotionId]   = useState(initialOrder?.promotionId   ?? '')
  const [promotionName, setPromotionName] = useState(initialOrder?.promotionName ?? '')
  const [activePromos,  setActivePromos]  = useState<ActivePromotion[]>([])
  // 已確認的促銷品項（促銷選定後載入）
  const [promoItems,    setPromoItems]    = useState<PromotionItem[]>([])
  // 追蹤 buy_n_get_m 的贈品列：mainItemId → giftItemId
  const [giftLinkMap,   setGiftLinkMap]   = useState<Record<string, string>>({})
  // 促銷提示文字：itemId → label
  const [promoHints,    setPromoHints]    = useState<Record<string, string>>({})

  // 跨規格系列買N送M 進度：seriesId → { seriesName, n, m, totalQty, freeQty }
  const seriesBuyNGetMStatus = useMemo(() => {
    const result: Record<string, { seriesName: string; n: number; m: number; totalQty: number; freeQty: number }> = {}
    const seriesPromos = promoItems.filter(p => p.conditionType === 'series_buy_n_get_m' && p.seriesId)
    for (const promo of seriesPromos) {
      const params = promo.conditionParams as any
      if (!params?.n || !params?.m) continue
      const totalQty = items
        .filter(it => it.seriesId === promo.seriesId && it.itemType !== 'gift' && it.itemType !== 'sample')
        .reduce((sum, it) => sum + (it.quantity || 1), 0)
      // 訂單尚未有此系列品項 → 不顯示進度橫幅（避免沒訂卻跳出來）
      if (totalQty <= 0) continue
      result[promo.seriesId] = {
        seriesName: promo.seriesName || promo.skuName || '系列優惠',
        n: params.n,
        m: params.m,
        totalQty,
        freeQty: Math.floor(totalQty / params.n) * params.m,
      }
    }
    return result
  }, [items, promoItems])

  // 以贈品身份加入品項（跨規格系列買N送M 自選贈品用）
  const handleAddGift = useCallback((partial: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => {
    setItems((prev) => [...prev, {
      ...partial,
      id:        `gift-${Date.now()}-${Math.random()}`,
      quantity:  1,
      unitPrice: 0,
      itemType:  'gift',
      note:      '[促銷贈品]',
    } as OrderItem])
  }, [])

  // 達標自動跳出該系列選單選贈品（每個系列只自動彈一次；之後用 banner 按鈕重開）
  useEffect(() => {
    for (const [seriesId, s] of Object.entries(seriesBuyNGetMStatus)) {
      if (s.freeQty <= 0 || autoGiftPromptedRef.current.has(seriesId)) continue
      const giftCount = items
        .filter((it) => it.seriesId === seriesId && (it.itemType === 'gift' || it.itemType === 'sample'))
        .reduce((sum, it) => sum + (it.quantity || 1), 0)
      if (giftCount >= s.freeQty) continue
      autoGiftPromptedRef.current.add(seriesId)
      setGiftPicker({ seriesId, seriesName: s.seriesName })
      break
    }
  }, [seriesBuyNGetMStatus, items])

  // 客戶資訊
  const [customer, setCustomer] = useState<SelectedCustomer>({
    id: initialOrder?.customerId ?? prefill?.customerId ?? '',
    name: initialOrder?.customerName ?? prefill?.customerName ?? '',
    companyTitle: initialOrder?.companyTitle ?? prefill?.companyTitle ?? '',
    address: initialOrder?.customerAddress ?? prefill?.customerAddress ?? '',
    phone: initialOrder?.customerPhone ?? prefill?.customerPhone ?? '',
    contactPerson: initialOrder?.contactPerson ?? prefill?.contactPerson ?? '',
    taxId: initialOrder?.customerTaxId ?? prefill?.customerTaxId ?? '',
  })

  // Load salesperson options
  useEffect(() => {
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.salespersons)) setSalespersonOptions(data.salespersons) })
      .catch(() => {})
  }, [])

  // Load active promotions for the dropdown
  useEffect(() => {
    fetch('/api/promotions?active=1')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setActivePromos(data) })
      .catch(() => {})
  }, [])

  // 促銷選定後，載入該活動已確認的品項條件
  useEffect(() => {
    if (!promotionId) {
      setPromoItems([])
      setGiftLinkMap({})
      setPromoHints({})
      appliedPromoRef.current = ''   // 清空促銷時重置，讓重新選回同一活動也能套用
      return
    }
    fetch(`/api/promotions/${promotionId}/items`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setPromoItems((data as PromotionItem[]).filter((i) => i.status === '已確認'))
        }
      })
      .catch(() => {})
  }, [promotionId])

  // ── refs ──────────────────────────────────────────────────────
  // itemsRef：讓 re-apply effect 讀到最新的 items，不需要把 items 加入 deps（避免無限 loop）
  const itemsRef       = useRef<OrderItem[]>(initialOrder?.items ?? [])
  // appliedPromoRef：記錄已 re-apply 過的 promotionId，避免重複執行
  // 初始值設為既有訂單的 promotionId，使 re-apply effect 在載入時不重複套用
  const appliedPromoRef = useRef(initialOrder?.promotionId ?? '')
  useEffect(() => { itemsRef.current = items }, [items])

  // 促銷品項載入後，重新對現有品項套用折扣（處理兩種 race condition）
  // ① 先選促銷再加品項 → promoItems 還未回來時品項已入列 → 這裡補套
  // ② 先加品項再選促銷 → 同上
  useEffect(() => {
    if (!promotionId || promoItems.length === 0) return
    if (appliedPromoRef.current === promotionId) return   // 同一個活動不重複套
    appliedPromoRef.current = promotionId

    const currentItems = itemsRef.current
    if (currentItems.length === 0) return

    const newHints: Record<string, string> = {}
    const updatedItems = currentItems.map((item) => {
      if (item.itemType === 'gift' || item.itemType === 'sample') return item

      const promoItem = matchPromoItem(item, promoItems)

      if (!promoItem?.conditionType) return item

      // 用 baseUnitPrice 快照作為折扣基礎（避免複利），沒有快照就用當前 unitPrice
      const baseItem = { ...item, unitPrice: item.baseUnitPrice ?? item.unitPrice }
      const { patches, hintLabel } = applyPromoCondition(baseItem, promoItem)
      if (hintLabel) newHints[item.id] = hintLabel
      return { ...item, ...patches }
    })

    setItems(updatedItems)
    if (Object.keys(newHints).length > 0)
      setPromoHints((h) => ({ ...h, ...newHints }))

    // unitPrice=0 的品項（FamilySpecPanel 選品）→ 補查 Notion 售價後重新套折
    updatedItems.forEach((item) => {
      if (item.unitPrice > 0 || item.itemType === 'gift' || item.itemType === 'sample') return
      if (!item.skuCode) return
      fetch(`/api/products/sku/${encodeURIComponent(item.skuCode)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: { catalog?: { price?: number | null } } | null) => {
          const actualPrice = data?.catalog?.price ?? 0
          if (!actualPrice) return

          const promoItem = matchPromoItem(item, promoItems)

          if (promoItem?.conditionType) {
            const baseItem2 = { ...item, unitPrice: actualPrice }
            const { patches: rp, hintLabel: rh } = applyPromoCondition(baseItem2, promoItem)
            setItems((prev) => prev.map((it) =>
              it.id === item.id ? { ...it, unitPrice: actualPrice, ...rp } : it
            ))
            if (rh) setPromoHints((h) => ({ ...h, [item.id]: rh }))
          } else {
            setItems((prev) => prev.map((it) =>
              it.id === item.id ? { ...it, unitPrice: actualPrice } : it
            ))
          }
        })
        .catch(() => {})
    })
  }, [promotionId, promoItems])

  // Add item from picker — with promotion logic
  const handleAddItem = useCallback(
    (partial: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => {
      // 已存在：只加數量（buy_n_get_m 的贈品更新由 handleQtyChange 接手）
      // 沒有貨號（自訂品項）不合併——否則第二個自訂品項會被加進第一個的數量
      const existingItem = partial.skuCode ? items.find((it) => it.skuCode === partial.skuCode && it.itemType !== 'gift' && it.itemType !== 'sample') : undefined
      if (existingItem) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === existingItem.id ? { ...it, quantity: it.quantity + 1 } : it
          )
        )
        return
      }

      const itemId = `item-${Date.now()}-${Math.random()}`
      const newItem: OrderItem = {
        ...partial,
        id:        itemId,
        quantity:  1,
        note:      '',
        unitPrice: partial.unitPrice ?? 0,
      }

      // 找對應的已確認促銷品項（SKU 精確比對 → 系列 ID 比對）
      const promoItem = matchPromoItem(partial, promoItems)

      // 套用促銷條件（無條件時 patches 為空）
      const { patches, giftRows, hintLabel } = promoItem?.conditionType
        ? applyPromoCondition(newItem, promoItem)
        : { patches: {} as Partial<OrderItem>, giftRows: [] as OrderItem[], hintLabel: null as string | null }

      const finalItem = { ...newItem, ...patches }

      // buy_n_get_m：qty=1 時先計算是否夠 n，夠就插贈品
      const extraGiftRows: OrderItem[] = [...giftRows]
      const newGiftLinks: Record<string, string> = {}
      if (promoItem?.conditionType === 'buy_n_get_m') {
        const p = promoItem.conditionParams as any
        if (p?.n && p?.m) {
          const giftQty = calcBuyNGetMGiftQty(1, p.n, p.m)
          if (giftQty > 0) {
            const giftId = `gift-${Date.now()}-${Math.random()}`
            extraGiftRows.push({
              id: giftId, skuCode: finalItem.skuCode, skuName: finalItem.skuName,
              brand: finalItem.brand, seriesName: finalItem.seriesName ?? '',
              seriesId: finalItem.seriesId ?? '',
              quantity: giftQty, unitPrice: 0, itemType: 'gift',
              note: `[促銷贈品] 買${p.n}送${p.m}`,
            } as OrderItem)
            newGiftLinks[finalItem.id] = giftId
          }
        }
      }

      setItems((prev) => [...prev, finalItem, ...extraGiftRows])
      if (Object.keys(newGiftLinks).length > 0)
        setGiftLinkMap((lm) => ({ ...lm, ...newGiftLinks }))
      if (hintLabel)
        setPromoHints((h) => ({ ...h, [itemId]: hintLabel }))

      // ── 非同步補查定價 ────────────────────────────────────────
      // FamilySpecPanel 選品時 unitPrice=0（靜態 catalog 無價格）。
      // 使用 /api/products/sku/[skuCode] 查有效售價（中央覆寫優先、目錄基準價次之）。
      // 查到後：若有促銷條件 → 以實際定價重新套折扣；否則直接更新單價。
      if ((partial.unitPrice ?? 0) === 0 && partial.skuCode) {
        fetch(`/api/products/sku/${encodeURIComponent(partial.skuCode)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data: { catalog?: { price?: number | null } } | null) => {
            const actualPrice = data?.catalog?.price ?? 0
            if (!actualPrice) return

            if (promoItem?.conditionType) {
              // 以實際定價重新套促銷
              const baseItem = { ...newItem, unitPrice: actualPrice }
              const { patches: rp, hintLabel: rh } = applyPromoCondition(baseItem, promoItem)
              setItems((prev) => prev.map((it) =>
                it.id === itemId ? { ...it, unitPrice: actualPrice, ...rp } : it
              ))
              if (rh) setPromoHints((h) => ({ ...h, [itemId]: rh }))
            } else {
              setItems((prev) => prev.map((it) =>
                it.id === itemId ? { ...it, unitPrice: actualPrice } : it
              ))
            }
          })
          .catch(() => {})
      }
    },
    [items, promoItems]
  )

  const updateItem = useCallback(
    (id: string, changes: Partial<OrderItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...changes } : it))
      )
    },
    []
  )

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    // 若刪除的是主商品，也刪除對應贈品列
    setGiftLinkMap((lm) => {
      const giftId = lm[id]
      if (!giftId) return lm
      setItems((prev) => prev.filter((it) => it.id !== giftId))
      const next = { ...lm }; delete next[id]; return next
    })
    setPromoHints((h) => { const next = { ...h }; delete next[id]; return next })
  }, [])

  // 數量變更：聯動 buy_n_get_m 贈品 & fixed_set_price 帶價
  const handleQtyChange = useCallback(
    (item: OrderItem, newQty: number) => {
      updateItem(item.id, { quantity: newQty })

      const promoItem = matchPromoItem(item, promoItems)
      if (!promoItem?.conditionType || !promoItem.conditionParams) return

      const p = promoItem.conditionParams as any

      if (promoItem.conditionType === 'buy_n_get_m' && p?.n && p?.m) {
        const giftQty      = calcBuyNGetMGiftQty(newQty, p.n, p.m)
        const existGiftId  = giftLinkMap[item.id]

        if (giftQty <= 0 && existGiftId) {
          // 不夠 n 件：移除贈品列
          setItems((prev) => prev.filter((it) => it.id !== existGiftId))
          setGiftLinkMap((lm) => { const next = { ...lm }; delete next[item.id]; return next })
        } else if (giftQty > 0 && existGiftId) {
          // 更新贈品數量
          updateItem(existGiftId, { quantity: giftQty })
        } else if (giftQty > 0 && !existGiftId) {
          // 新增贈品列
          const giftId = `gift-${Date.now()}-${Math.random()}`
          const giftRow = {
            id: giftId, skuCode: item.skuCode, skuName: item.skuName,
            brand: item.brand, seriesName: item.seriesName ?? '', seriesId: item.seriesId ?? '',
            quantity: giftQty, unitPrice: 0, itemType: 'gift' as ItemType,
            note: `[促銷贈品] 買${p.n}送${p.m}`,
          } as OrderItem
          setItems((prev) => [...prev, giftRow])
          setGiftLinkMap((lm) => ({ ...lm, [item.id]: giftId }))
        }
      }

      if (promoItem.conditionType === 'fixed_set_price' && (p?.tiers ?? []).length > 0) {
        // 找最接近且 >= newQty 的 tier（或精確匹配）
        const exact = (p.tiers as { qty: number; totalPrice: number }[]).find((t) => t.qty === newQty)
        if (exact) {
          updateItem(item.id, { unitPrice: Math.round(exact.totalPrice / exact.qty) })
        }
      }

      if (promoItem.conditionType === 'qty_discount' && (p?.tiers ?? []).length > 0) {
        // 找最高滿足的 tier
        const applicable = (p.tiers as { minQty: number; rate?: number; price?: number }[])
          .filter((t) => newQty >= t.minQty)
          .sort((a, b) => b.minQty - a.minQty)[0]
        if (applicable?.price != null) {
          updateItem(item.id, { unitPrice: applicable.price })
        } else if (applicable?.rate != null) {
          // rate 型：用 baseUnitPrice 快照計算，避免複利折扣
          const base = item.baseUnitPrice ?? item.unitPrice
          if (base > 0) updateItem(item.id, { unitPrice: Math.round(base * applicable.rate) })
        }
      }
    },
    [promoItems, giftLinkMap, updateItem]
  )

  // ── 存檔 ────────────────────────────────────────────────────────
  const [requestedDate, setRequestedDate] = useState(initialOrder?.requestedDate ?? '')
  const [paymentMethod, setPaymentMethod] = useState(initialOrder?.paymentMethod ?? prefill?.paymentMethod ?? '')
  const [deliveryMethod, setDeliveryMethod] = useState(initialOrder?.deliveryMethod ?? prefill?.deliveryMethod ?? '')
  const [openDetail, setOpenDetail] = useState<string[]>([])
  const [statusBusy, setStatusBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  // 未存檔變更：與載入時的內容比較（離開頁面提醒、狀態轉換前提醒）
  const snapshot = JSON.stringify({ date, salesperson, note, items, customer, promotionId, requestedDate, paymentMethod, deliveryMethod })
  const initialSnapshot = useRef<string | null>(null)
  useEffect(() => { if (initialSnapshot.current === null && date) initialSnapshot.current = snapshot }, [date, snapshot])
  const dirty = initialSnapshot.current !== null && initialSnapshot.current !== snapshot
  useEffect(() => {
    if (!dirty || !canEdit) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, canEdit])

  const itemsChanged = JSON.stringify(items) !== JSON.stringify(initialOrder?.items ?? [])

  function validate(): string {
    if (!salesperson.trim()) return '請選擇業務承辦'
    if (items.length === 0) return '請至少新增一個品項'
    if (items.some((it) => !it.skuName.trim())) return '有品項沒有品名'
    // 跨規格系列買N送M：門檻已達但未加入贈品，不允許儲存
    for (const s of Object.entries(seriesBuyNGetMStatus).map(([id, v]) => ({ id, ...v }))) {
      if (s.freeQty <= 0) continue
      const giftCount = items.filter((it) => it.seriesId === s.id && (it.itemType === 'gift' || it.itemType === 'sample'))
        .reduce((sum, it) => sum + (it.quantity || 1), 0)
      if (giftCount < s.freeQty) return `「${s.seriesName}」買${s.n}送${s.m}門檻已達，請加入 ${s.freeQty} 件贈品（目前 ${giftCount} 件）後再儲存`
    }
    return ''
  }

  const payload = () => ({
    date, salesperson, note, promotionId, promotionName, requestedDate, paymentMethod, deliveryMethod,
    customerId: customer.id, customerName: customer.name, companyTitle: customer.companyTitle,
    customerAddress: customer.address, customerPhone: customer.phone, contactPerson: customer.contactPerson, customerTaxId: customer.taxId,
  })

  /**
   * 存檔。targetStatus：新單「草稿／已送出」；草稿編輯可一併送出；行政改非草稿單時不帶狀態（狀態另用轉換按鈕）。
   * 行政改非草稿單的品項會覆寫已凍結的價格快照：先確認，再帶 confirmNonDraftEdit（伺服器會留稽核）。
   */
  const handleSave = async (targetStatus?: '草稿' | '已送出') => {
    const msg = validate()
    if (msg) { setError(msg); return }
    const nonDraftItemEdit = isEdit && status !== '草稿' && itemsChanged
    if (nonDraftItemEdit && !window.confirm(`這張訂單已${status}，修改品項／價格會覆寫原本的單據內容，並留下稽核紀錄。確定要修改嗎？`)) return
    setError(''); setSaving(true)
    try {
      const body: Record<string, unknown> = { ...payload() }
      if (!isEdit || status === '草稿' || itemsChanged) body.items = items
      if (nonDraftItemEdit) body.confirmNonDraftEdit = true
      if (targetStatus && (!isEdit || targetStatus !== status)) body.status = targetStatus
      const res = await fetch(isEdit ? `/api/orders/${initialOrder!.id}` : '/api/orders', {
        method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `伺服器錯誤 (${res.status})`)
      initialSnapshot.current = snapshot
      router.push('/orders')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '儲存失敗，請重試')
    } finally { setSaving(false) }
  }

  /** 狀態轉換（確認受理、標記到貨、撤回、取消…），規則見 lib/order-status */
  const changeStatus = async (to: string, label: string) => {
    if (!initialOrder) return
    if (dirty && !window.confirm('有尚未儲存的修改，轉換狀態不會一併儲存。仍要繼續嗎？')) return
    if (to === '已取消' && !window.confirm('確定要取消這張訂單嗎？之後可由行政恢復為草稿。')) return
    setStatusBusy(true); setError('')
    try {
      const res = await fetch(`/api/orders/${initialOrder.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `${label}失敗`)
      router.refresh()
      setStatus(to)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${label}失敗`)
    } finally { setStatusBusy(false) }
  }

  const previewPdf = async () => {
    if (isEdit && !dirty) { window.open(`/api/orders/${initialOrder!.id}/pdf`, '_blank'); return }
    setPreviewing(true); setError('')
    const win = window.open('', '_blank')
    try {
      const res = await fetch('/api/orders/preview-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), items, status, orderNumber: initialOrder?.orderNumber ?? '' }),
      })
      if (!res.ok) { win?.close(); setError('PDF 預覽失敗'); return }
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location.href = url; else window.open(url, '_blank')
    } catch { win?.close(); setError('PDF 預覽失敗') }
    finally { setPreviewing(false) }
  }

  const addCustomItem = () => {
    const id = `custom-${Date.now()}-${Math.random()}`
    setItems((prev) => [...prev, { id, skuCode: '', skuName: '', brand: '', seriesName: '', seriesId: '', quantity: 1, unitPrice: 0, note: '', itemType: 'normal' } as OrderItem])
    setOpenDetail((prev) => [...prev, id])
  }
  const toggleDetail = (id: string) => setOpenDetail((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const totalQty = items.reduce((acc, it) => acc + it.quantity, 0)
  const freeQty = items.filter((it) => it.itemType === 'gift' || it.itemType === 'sample').reduce((a, it) => a + it.quantity, 0)
  const totalAmount = calcTotal(items)
  const brandStats = Object.entries(items.reduce((acc, it) => {
    const k = it.brand || '其他'
    if (!acc[k]) acc[k] = { qty: 0, amt: 0 }
    acc[k].qty += it.quantity
    if (it.itemType !== 'gift' && it.itemType !== 'sample') acc[k].amt += it.quantity * (it.unitPrice || 0)
    return acc
  }, {} as Record<string, { qty: number; amt: number }>)).sort((a, b) => b[1].amt - a[1].amt || b[1].qty - a[1].qty)

  const transitions = isEdit ? allowedOrderTransitions(status, actor).filter((t) => !(t.action === 'submit' && canEdit)) : []
  const isDraftLike = !isEdit || status === '草稿'

  const sectionCls = 'card-soft rounded-3xl p-5 sm:p-6'
  const sectionHead = (step: string, title: string, desc?: string) => (
    <div>
      <p className="text-[11px] font-semibold tracking-widest text-stone-400">{step}</p>
      <h2 className="mt-0.5 text-base font-bold text-stone-800">{title}</h2>
      {desc && <p className="mt-0.5 text-xs text-stone-400">{desc}</p>}
    </div>
  )
  const inputCls = 'input-soft py-3 disabled:bg-stone-50 disabled:text-stone-500'

  return (
    <div className="grid gap-5 pb-44 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:pb-0">
      <div className="min-w-0 space-y-5">
        {!canEdit && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">🔒 {lockedNote ?? '僅限閱覽，無編輯權限'}</div>
        )}

        {/* STEP 1 客戶 */}
        <section className={sectionCls}>
          {sectionHead('STEP 1', '收貨客戶', '搜尋客戶主檔會自動帶入；帶入後每個欄位仍可修改。')}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="客戶名稱" className="sm:col-span-2">
              <CustomerNameInput customer={customer} onChange={setCustomer} disabled={!canEdit} />
            </Field>
            <Field label="聯絡人"><input value={customer.contactPerson} onChange={(e) => setCustomer((c) => ({ ...c, contactPerson: e.target.value }))} disabled={!canEdit} className={inputCls} placeholder="例：陳技師" /></Field>
            <Field label="電話"><input value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} disabled={!canEdit} className={inputCls} inputMode="tel" /></Field>
            <Field label="公司抬頭" hint="開立發票用"><input value={customer.companyTitle} onChange={(e) => setCustomer((c) => ({ ...c, companyTitle: e.target.value }))} disabled={!canEdit} className={inputCls} placeholder="同客戶名稱可留空" /></Field>
            <Field label="統一編號"><input value={customer.taxId} onChange={(e) => setCustomer((c) => ({ ...c, taxId: e.target.value }))} disabled={!canEdit} className={inputCls} inputMode="numeric" maxLength={8} /></Field>
            <Field label="送貨地址" className="sm:col-span-2"><input value={customer.address} onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))} disabled={!canEdit} className={inputCls} /></Field>
          </div>
        </section>

        {/* STEP 2 訂購條件 */}
        <section className={sectionCls}>
          {sectionHead('STEP 2', '訂購條件', '會印在訂購單的「訂購資訊」。')}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="訂購日期" hint={rocDate(date)}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} className={inputCls} /></Field>
            <Field label="希望到貨日" hint={rocDate(requestedDate)}><input type="date" value={requestedDate} min={date} onChange={(e) => setRequestedDate(e.target.value)} disabled={!canEdit} className={inputCls} /></Field>
            <Field label="業務承辦 *">
              {salespersonOptions.length > 0 ? (
                <select value={salesperson} onChange={(e) => setSalesperson(e.target.value)} disabled={!canEdit} className="select-soft w-full py-3">
                  <option value="">請選擇</option>
                  {salespersonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  {salesperson && !salespersonOptions.includes(salesperson) && <option value={salesperson}>{salesperson}</option>}
                </select>
              ) : (
                <input value={salesperson} onChange={(e) => setSalesperson(e.target.value)} disabled={!canEdit} className={inputCls} placeholder="輸入姓名" />
              )}
            </Field>
            <Field label="關聯促銷活動">
              <select value={promotionId} disabled={!canEdit} className="select-soft w-full py-3"
                onChange={(e) => {
                  const id = e.target.value
                  const promo = activePromos.find((p) => p.id === id)
                  setPromotionId(id); setPromotionName(promo?.name ?? '')
                  setNote((prev) => {
                    if (!promo) return prev.startsWith('促銷活動：') ? '' : prev
                    if (!prev.trim() || prev.startsWith('促銷活動：')) return `促銷活動：${promo.name}`
                    return prev
                  })
                }}>
                <option value="">— 無關聯活動 —</option>
                {activePromos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {promotionId && !activePromos.find((p) => p.id === promotionId) && <option value={promotionId}>{promotionName}</option>}
              </select>
            </Field>
            <Field label="付款方式">
              <input list="order-payment" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={!canEdit} className={inputCls} placeholder="可選常用或自行輸入" />
              <datalist id="order-payment">{PAYMENT_METHOD_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="送貨方式">
              <input list="order-delivery" value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} disabled={!canEdit} className={inputCls} placeholder="可選常用或自行輸入" />
              <datalist id="order-delivery">{DELIVERY_METHOD_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="備註" hint="每行一條，印在訂購單備註區" className="sm:col-span-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} rows={3} className="input-soft resize-y py-3 disabled:bg-stone-50" placeholder="例：請於週五前送達" />
            </Field>
          </div>
        </section>

        {/* STEP 3 品項 */}
        <section className="card-soft overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
            {sectionHead('STEP 3', `訂貨品項${items.length ? `（${items.length} 項 · ${totalQty} 件）` : ''}`, '從產品目錄加入會套用促銷與售價；自訂品項可填運費、維修等目錄外項目。')}
            {canEdit && (
              <div className="flex gap-2">
                <button type="button" onClick={addCustomItem} className="button-secondary px-4 py-2">＋ 自訂品項</button>
                <button type="button" onClick={() => setShowPicker(true)} className="button-primary px-4 py-2">＋ 從目錄加入</button>
              </div>
            )}
          </div>

          {/* 跨規格系列買N送M 進度 */}
          {Object.entries(seriesBuyNGetMStatus).map(([seriesId, { seriesName, n, m, totalQty: sq, freeQty: fq }]) => {
            const reached = fq > 0
            const giftCount = items.filter((it) => it.seriesId === seriesId && (it.itemType === 'gift' || it.itemType === 'sample')).reduce((sum, it) => sum + (it.quantity || 1), 0)
            const remaining = Math.max(0, fq - giftCount)
            return (
              <div key={seriesId} className={`mx-5 mb-3 rounded-2xl px-4 py-3 text-sm sm:mx-6 ${reached ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : 'bg-stone-50 text-stone-600 ring-1 ring-stone-200'}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium">{reached ? '🎁' : '🏷'} {seriesName}<span className="ml-2 text-xs font-normal opacity-70">買{n}送{m}（同系列跨規格合計）</span></span>
                  <span className="text-xs font-semibold">{sq} / {n} 件{fq > 0 && ` → 可自選 ${fq} 件贈品`}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
                  <div className={`h-full rounded-full transition-all ${reached ? 'bg-brand-400' : 'bg-stone-400'}`} style={{ width: `${sq === 0 ? 0 : Math.min(100, (sq / n) * 100)}%` }} />
                </div>
                {reached && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-xs ${remaining > 0 ? 'font-medium text-amber-700' : 'text-emerald-700'}`}>{remaining > 0 ? `⚠ 尚未選滿贈品，還需 ${remaining} 件` : `✓ 已選 ${giftCount} 件贈品`}</span>
                    {canEdit && <button type="button" onClick={() => setGiftPicker({ seriesId, seriesName })} className="button-primary px-3 py-1.5 text-xs">🎁 選擇贈品</button>}
                  </div>
                )}
              </div>
            )
          })}

          {items.length === 0 ? (
            <div className="mx-5 mb-5 rounded-2xl border border-dashed border-stone-200 px-4 py-12 text-center sm:mx-6">
              <div className="text-3xl">📦</div>
              <p className="mt-2 text-sm text-stone-400">尚未新增品項</p>
              <p className="mt-0.5 text-xs text-stone-300">按「＋ 從目錄加入」選擇商品</p>
            </div>
          ) : (
            <div className="px-3 pb-3 sm:px-4 sm:pb-4">
              <div className="hidden grid-cols-[28px_minmax(0,1fr)_72px_108px_96px_96px_64px] gap-2 px-2 pb-2 text-[11px] font-medium text-stone-400 xl:grid">
                <span>#</span><span>品名</span><span className="text-center">類型</span><span className="text-center">數量</span>
                <span className="text-right">單價</span><span className="text-right">金額</span><span />
              </div>
              <ul className="space-y-2">
                {items.map((item, idx) => {
                  const type = (item.itemType ?? 'normal') as ItemType
                  const isGift = type === 'gift' || type === 'sample'
                  const qty = Math.max(1, item.quantity || 1)
                  const price = isGift ? 0 : (item.unitPrice || 0)
                  const detail = openDetail.includes(item.id)
                  const custom = !item.skuCode
                  const setQty = (v: number) => (isGift ? updateItem(item.id, { quantity: v }) : handleQtyChange(item, v))
                  return (
                    <li key={item.id} className={`rounded-2xl p-2 ring-1 ring-stone-900/[0.06] ${isGift ? 'bg-brand-50/40' : 'bg-white'}`}>
                      <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2 xl:grid-cols-[28px_minmax(0,1fr)_72px_108px_96px_96px_64px] xl:items-center">
                        <span className="pt-2 text-center text-xs tabular-nums text-stone-400 xl:pt-0">{idx + 1}</span>
                        <div className="min-w-0 px-1">
                          {custom && canEdit ? (
                            <input value={item.skuName} onChange={(e) => updateItem(item.id, { skuName: e.target.value })} className="input-soft py-2" placeholder="品名（例：運費、維修工資）" />
                          ) : (
                            <p className="text-sm font-medium leading-snug text-stone-800">{item.skuName || '（未命名）'}</p>
                          )}
                          <p className="mt-0.5 truncate text-[11px] text-stone-400">
                            {[custom ? '自訂品項' : item.skuCode, item.brand, item.note].filter(Boolean).join('　·　')}
                          </p>
                          {promoHints[item.id] && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">⚡ {promoHints[item.id]}</span>
                          )}
                        </div>
                        <div className="col-span-2 grid grid-cols-[72px_1fr_1fr] items-end gap-2 xl:contents">
                          <label className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">類型</span>
                            <select value={type} disabled={!canEdit}
                              onChange={(e) => { const next = e.target.value as ItemType; updateItem(item.id, { itemType: next, unitPrice: next === 'gift' || next === 'sample' ? 0 : item.unitPrice }) }}
                              className={`w-full rounded-full border-0 px-2 py-1.5 text-center text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-400/40 ${ITEM_TYPE_COLOR[type]}`}>
                              <option value="normal">一般</option><option value="gift">贈品</option><option value="sample">樣品</option>
                            </select>
                          </label>
                          <div className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">數量</span>
                            {canEdit ? (
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 ring-1 ring-stone-200 hover:bg-stone-100 active:scale-95">−</button>
                                <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="input-soft w-12 px-1 py-1.5 text-center tabular-nums" />
                                <button type="button" onClick={() => setQty(qty + 1)} className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 ring-1 ring-stone-200 hover:bg-stone-100 active:scale-95">+</button>
                              </div>
                            ) : <span className="block text-center text-sm tabular-nums">{qty}</span>}
                          </div>
                          <label className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">單價</span>
                            {isGift ? <span className="block text-right text-sm text-emerald-700">贈送</span>
                              : canEdit ? (
                                <input type="number" min={0} value={price > 0 ? price : ''} placeholder="待定價"
                                  onChange={(e) => { const v = parseFloat(e.target.value); updateItem(item.id, { unitPrice: isFinite(v) && v >= 0 ? v : 0 }) }}
                                  className={`input-soft py-1.5 text-right tabular-nums ${price <= 0 ? 'ring-1 ring-amber-300' : ''}`} />
                              ) : <span className="block text-right text-sm tabular-nums">{price > 0 ? price.toLocaleString() : '—'}</span>}
                          </label>
                        </div>
                        <div className="col-span-2 flex items-center justify-between gap-2 xl:col-span-1 xl:contents">
                          <span className="text-sm font-semibold tabular-nums text-stone-800 xl:text-right">
                            <span className="mr-1 text-[11px] font-normal text-stone-400 xl:hidden">金額</span>
                            {isGift ? <span className="text-xs font-normal text-emerald-700">—</span> : price > 0 ? (qty * price).toLocaleString() : <span className="text-xs font-normal text-amber-600">待定價</span>}
                          </span>
                          <div className="flex items-center justify-end gap-0.5">
                            <button type="button" onClick={() => toggleDetail(item.id)} className={`whitespace-nowrap rounded-full px-2 py-1 text-xs transition-all active:scale-95 ${detail ? 'bg-brand-50 text-brand-700' : 'text-stone-400 hover:bg-stone-100'}`}>詳細</button>
                            {canEdit && <button type="button" onClick={() => removeItem(item.id)} title="刪除" className="rounded-full px-2 py-1 text-stone-300 hover:bg-red-50 hover:text-red-500">✕</button>}
                          </div>
                        </div>
                      </div>
                      {detail && (
                        <div className="mt-2 grid grid-cols-1 gap-3 rounded-xl bg-stone-50 p-3 sm:grid-cols-2 xl:ml-[36px]">
                          <Field label="品名" hint={custom ? '' : '可改顯示名稱，貨號不變'}>
                            <input value={item.skuName} onChange={(e) => updateItem(item.id, { skuName: e.target.value })} disabled={!canEdit} className="input-soft bg-white py-2 disabled:bg-stone-100" />
                          </Field>
                          <Field label="品牌">
                            <input value={item.brand} onChange={(e) => updateItem(item.id, { brand: e.target.value })} disabled={!canEdit || !custom} className="input-soft bg-white py-2 disabled:bg-stone-100" />
                          </Field>
                          <Field label="品項備註" hint="印在品名下方" className="sm:col-span-2">
                            <input value={item.note ?? ''} onChange={(e) => updateItem(item.id, { note: e.target.value })} disabled={!canEdit} className="input-soft bg-white py-2 disabled:bg-stone-100" placeholder="例：指定批號" />
                          </Field>
                          {!custom && <p className="text-[11px] text-stone-400 sm:col-span-2">貨號 {item.skuCode}{item.seriesName ? `・${item.seriesName}` : ''}（單價為加入當下的售價，之後目錄調價不會改動這張訂單）</p>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* 右側摘要 */}
      <aside className="space-y-4 lg:sticky lg:top-4">
        <div className="card-soft rounded-3xl p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-stone-400">訂單編號</p>
              <p className="mt-0.5 font-mono text-sm text-stone-700">{initialOrder?.orderNumber ?? '存檔後自動產生'}</p>
            </div>
            {isEdit && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLE[status] ?? 'bg-stone-100 text-stone-600'}`}>{status}</span>}
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">品項</dt><dd className="tabular-nums text-stone-700">{items.length} 項 · {totalQty} 件</dd></div>
            {freeQty > 0 && <div className="flex justify-between"><dt className="text-stone-500">其中贈品／樣品</dt><dd className="tabular-nums text-stone-700">{freeQty} 件</dd></div>}
            <div className="flex items-end justify-between border-t border-stone-100 pt-3">
              <dt className="text-stone-600">合計</dt>
              <dd className="text-2xl font-bold tabular-nums text-brand-700">NT$ {totalAmount.toLocaleString('zh-TW')}</dd>
            </div>
          </dl>
          {brandStats.length > 1 && (
            <details className="mt-3 text-xs text-stone-500">
              <summary className="cursor-pointer text-stone-400 hover:text-stone-600">依品牌（{brandStats.length}）</summary>
              <ul className="mt-2 space-y-1">
                {brandStats.map(([b, v]) => (
                  <li key={b} className="flex justify-between gap-2"><span className="truncate">{b}</span><span className="shrink-0 tabular-nums">{v.qty} 件{v.amt > 0 ? ` · ${v.amt.toLocaleString()}` : ''}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {transitions.length > 0 && (
          <div className="card-soft rounded-3xl p-5">
            <p className="mb-2 text-xs font-semibold text-stone-500">訂單狀態</p>
            <div className="flex flex-wrap gap-2">
              {transitions.map((t) => (
                <button key={t.action} type="button" disabled={statusBusy} onClick={() => changeStatus(t.to, t.label)}
                  className={t.tone === 'primary' ? 'button-primary px-4 py-2 text-xs' : t.tone === 'danger'
                    ? 'rounded-full px-4 py-2 text-xs font-medium text-red-600 ring-1 ring-red-200 transition-all hover:bg-red-50 active:scale-95 disabled:opacity-50'
                    : 'button-secondary px-4 py-2 text-xs'}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-900/[0.06] bg-[#fdfdfb]/95 px-4 py-3 shadow-[0_-4px_24px_rgba(28,25,23,0.06)] backdrop-blur-xl lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="mb-2 flex items-baseline justify-between lg:hidden">
            <span className="text-xs text-stone-500">{items.length} 項 · {totalQty} 件</span>
            <span className="text-lg font-bold tabular-nums text-brand-700">NT$ {totalAmount.toLocaleString('zh-TW')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col">
            {canEdit && isDraftLike && (
              <>
                <button type="button" onClick={() => handleSave('已送出')} disabled={saving} className="button-primary col-span-2 py-3 lg:w-full">
                  {saving ? '儲存中…' : isEdit ? '儲存並送出訂單' : '送出訂單'}
                </button>
                <button type="button" onClick={() => handleSave('草稿')} disabled={saving} className="button-secondary py-3 lg:w-full">儲存草稿</button>
              </>
            )}
            {canEdit && !isDraftLike && (
              <button type="button" onClick={() => handleSave()} disabled={saving || !dirty} className="button-primary col-span-2 py-3 lg:w-full">
                {saving ? '儲存中…' : dirty ? '儲存修改' : '沒有變更'}
              </button>
            )}
            <button type="button" onClick={previewPdf} disabled={previewing || items.length === 0}
              className={`button-secondary py-3 lg:w-full ${canEdit && isDraftLike ? '' : 'col-span-2'}`}>
              {previewing ? '產生中…' : isEdit && !dirty ? '訂購單 PDF' : '預覽 PDF'}
            </button>
            <button type="button" onClick={() => router.push('/orders')} className="hidden py-2 text-sm text-stone-400 hover:text-stone-600 lg:block lg:w-full">返回訂貨單清單</button>
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {showPicker && <ProductPicker onAdd={handleAddItem} onClose={() => setShowPicker(false)} />}
        {giftPicker && (
          <ProductPicker lockSeriesId={giftPicker.seriesId} lockSeriesName={giftPicker.seriesName}
            onAdd={(partial) => { handleAddGift(partial); setGiftPicker(null) }} onClose={() => setGiftPicker(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
