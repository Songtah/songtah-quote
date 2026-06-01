'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { OrderItem, ItemType } from '@/lib/orders-notion'
import type { PromotionItem } from '@/lib/promotion-items-notion'
import { ProductFamily, YMHToothGridPanel, FamilySpecPanel } from '@/components/FamilySpecPicker'

interface ActivePromotion { id: string; name: string; type: string; startDate: string; endDate: string }

// Inline to avoid importing server-side Notion client in the browser bundle
const calcTotal = (items: OrderItem[]): number =>
  items.reduce((sum, it) => {
    if (it.itemType === 'gift' || it.itemType === 'sample') return sum
    return sum + it.quantity * (it.unitPrice || 0)
  }, 0)

const ITEM_TYPE_LABEL: Record<ItemType, string>  = { normal: '一般', gift: '贈品', sample: '樣品' }
const ITEM_TYPE_COLOR: Record<ItemType, string>  = {
  normal: 'bg-gray-100 text-gray-600',
  gift:   'bg-green-100 text-green-700',
  sample: 'bg-blue-100 text-blue-700',
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

// ── 狀態顏色 ──────────────────────────────────────────────────

const STATUS_OPTIONS = ['草稿', '已送出', '確認中', '已到貨', '已取消'] as const
type StatusType = typeof STATUS_OPTIONS[number]

const STATUS_COLOR: Record<StatusType, string> = {
  草稿:   'bg-gray-100 text-gray-600',
  已送出: 'bg-blue-100 text-blue-700',
  確認中: 'bg-yellow-100 text-yellow-700',
  已到貨: 'bg-green-100 text-green-700',
  已取消: 'bg-red-100 text-red-600',
}

// ── ProductPicker ─────────────────────────────────────────────

function ProductPicker({
  onAdd,
  onClose,
}: {
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterType, setFilterType] = useState('')
  const [families, setFamilies] = useState<ProductFamily[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [allBrands, setAllBrands] = useState<string[]>([])
  const [allTypes, setAllTypes] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [browseItems, setBrowseItems] = useState<CatalogItem[]>([])
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null)
  const [notionAssignedCodes, setNotionAssignedCodes] = useState<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同時載入規格系列 + 完整目錄的篩選選項（44 品牌、7 類型）
  useEffect(() => {
    fetch('/api/products/families')
      .then((r) => r.json())
      .then((data) => { setFamilies(data); setFamiliesLoading(false) })
      .catch(() => setFamiliesLoading(false))

    fetch('/api/products/options')
      .then((r) => r.json())
      .then((data) => {
        if (data.brands) setAllBrands(data.brands)
        if (data.productTypes) setAllTypes(data.productTypes)
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
        const res = await fetch(`/api/products/search?${params}`)
        if (res.ok) setSearchResults(await res.json())
      } catch { /* ignore */ } finally { setSearchLoading(false) }
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search, filterBrand, filterType])

  const isSearching = search.trim().length > 0

  // 瀏覽模式：依品牌 / 類型篩選系列
  const filteredFamilies = useMemo(() => {
    if (!filterBrand && !filterType) return families
    return families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      return true
    })
  }, [families, filterBrand, filterType])

  // 搜尋模式：以關鍵字比對系列名稱 / 品牌 / 分類，同時套用 brand/type 篩選
  const familySearchResults = useMemo(() => {
    if (!search.trim()) return []
    const kw = search.trim().toLowerCase()
    return families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      return (
        f.seriesName.toLowerCase().includes(kw) ||
        f.brand.toLowerCase().includes(kw) ||
        f.category.toLowerCase().includes(kw) ||
        f.seriesCode.toLowerCase().includes(kw)
      )
    })
  }, [families, search, filterBrand, filterType])

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
    if (!filterBrand && !filterType) { setBrowseItems([]); return }
    const params = new URLSearchParams({ limit: '200' })
    if (filterBrand) params.set('brand', filterBrand)
    if (filterType)  params.set('type', filterType)
    fetch(`/api/products/search?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((items: CatalogItem[]) => {
        setBrowseItems(items.filter((it) => !coveredSkuCodes.has(it.skuCode)))
      })
      .catch(() => setBrowseItems([]))
  }, [isSearching, filterBrand, filterType, coveredSkuCodes])

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
        className="relative w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '92vh' }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b rounded-t-2xl">
          <h2 className="text-base font-semibold text-gray-800">選擇品項</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 border-b space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedFamilyId(null) }}
            placeholder="搜尋全部 6,037 筆商品（品名 / 貨品碼）..."
            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <div className="flex gap-2">
            <select
              value={filterBrand}
              onChange={(e) => { setFilterBrand(e.target.value); setExpandedFamilyId(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部品牌</option>
              {allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setExpandedFamilyId(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部類型</option>
              {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            /* ── 搜尋模式：規格系列優先，再顯示其餘個別品項 ── */
            searchLoading ? (
              <div className="text-center text-gray-400 py-12 text-sm animate-pulse">搜尋中...</div>
            ) : familySearchResults.length === 0 && remainingSearchResults.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">無符合品項</div>
            ) : (
              <div className="divide-y">
                {/* ① 符合的規格系列 */}
                {familySearchResults.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-gray-400 text-xs w-4 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{family.seriesName}</div>
                          <div className="text-xs text-gray-400 flex flex-wrap gap-1.5">
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
                        family.uiVariant === 'ymh-tooth-grid'
                          ? <YMHToothGridPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: 0 })}
                            />
                          : <FamilySpecPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: 0 })}
                            />
                      )}
                    </div>
                  )
                })}
                {/* ② 其餘不屬於任何規格系列的個別品項 */}
                {remainingSearchResults.length > 0 && (
                  <>
                    {familySearchResults.length > 0 && (
                      <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 text-xs text-gray-500 font-medium">
                        其他品項
                      </div>
                    )}
                    {remainingSearchResults.map((item) => (
                      <div
                        key={item.skuCode}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                          <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                    {remainingSearchResults.length >= 80 && (
                      <div className="text-center text-xs text-gray-400 py-3 bg-gray-50">
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
              <div className="text-center text-gray-400 py-12 text-sm animate-pulse">載入中...</div>
            ) : filteredFamilies.length === 0 ? (
              browseItems.length > 0 ? (
                <div className="divide-y">
                  {browseItems.map((item) => (
                    <div key={item.skuCode} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                        <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                          <span className="font-mono">{item.skuCode}</span>
                          <span>{item.manufacturer} · {item.category}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddCatalogItem(item)}
                        className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                      >
                        + 加入
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-12 text-sm">沒有符合條件的品項</div>
              )
            ) : (
              <div className="divide-y">
                {filteredFamilies.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-gray-400 text-xs w-4 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{family.seriesName}</div>
                          <div className="text-xs text-gray-400 flex flex-wrap gap-1.5">
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
                        family.uiVariant === 'ymh-tooth-grid'
                          ? <YMHToothGridPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: 0 })}
                            />
                          : <FamilySpecPanel
                              family={family}
                              onAdd={(code, name) => handleAddItem({ skuCode: code, skuName: name, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: 0 })}
                            />
                      )}
                    </div>
                  )
                })}
                {/* 篩選模式下，屬於該品牌/類型但不在規格系列中的個別品項 */}
                {browseItems.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 text-xs text-gray-500 font-medium">
                      其他品項
                    </div>
                    {browseItems.map((item) => (
                      <div key={item.skuCode} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                          <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {/* 提示：規格系列以外的品項請搜尋 */}
                {!filterBrand && !filterType && (
                <div className="px-4 py-3 bg-blue-50/60 border-t border-blue-100">
                  <p className="text-xs text-blue-600 leading-relaxed">
                    💡 以上為含規格選項的系列。其餘 <span className="font-semibold">6,037 筆</span> 商品請在上方搜尋欄輸入品名或貨品碼，或選擇品牌 / 類型篩選。
                  </p>
                </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t rounded-b-2xl text-xs text-gray-400 text-center bg-gray-50">
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
          className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500 pr-16"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 animate-pulse">搜尋中…</span>
        )}
        {!searching && customer.id && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-500">✓ 已連結</span>
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

/**
 * 計算買N送M的贈品數量（可重複觸發）
 * 買10送2（買5送1）→ floor(10/5)*1 = 2
 */
function calcBuyNGetMGiftQty(orderQty: number, n: number, m: number): number {
  return Math.floor(orderQty / n) * m
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
  }
  canEdit?: boolean
  /** 鎖定原因說明（傳入時覆蓋預設的「僅限閱覽」文字） */
  lockedNote?: string
}

export default function OrderForm({ initialOrder, canEdit = true, lockedNote }: OrderFormProps) {
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
  const [salesperson, setSalesperson] = useState(initialOrder?.salesperson ?? '')
  const [salespersonOptions, setSalespersonOptions] = useState<string[]>([])
  const [note, setNote] = useState(initialOrder?.note ?? '')
  const [status, setStatus] = useState<string>(initialOrder?.status ?? '草稿')
  const [items, setItems] = useState<OrderItem[]>(initialOrder?.items ?? [])
  const [showPicker, setShowPicker] = useState(false)
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

  // 客戶資訊
  const [customer, setCustomer] = useState<SelectedCustomer>({
    id: initialOrder?.customerId ?? '',
    name: initialOrder?.customerName ?? '',
    companyTitle: initialOrder?.companyTitle ?? '',
    address: initialOrder?.customerAddress ?? '',
    phone: initialOrder?.customerPhone ?? '',
    contactPerson: initialOrder?.contactPerson ?? '',
    taxId: initialOrder?.customerTaxId ?? '',
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

      const promoItem =
        promoItems.find((p) => p.skuCode && p.skuCode === item.skuCode) ??
        (item.seriesId ? promoItems.find((p) => p.seriesId && p.seriesId === item.seriesId) : undefined)

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
        .then((data: { rich?: { price?: number | null } } | null) => {
          const actualPrice = data?.rich?.price ?? 0
          if (!actualPrice) return

          const promoItem =
            promoItems.find((p) => p.skuCode && p.skuCode === item.skuCode) ??
            (item.seriesId ? promoItems.find((p) => p.seriesId && p.seriesId === item.seriesId) : undefined)

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
      const existingItem = items.find((it) => it.skuCode === partial.skuCode)
      if (existingItem) {
        setItems((prev) =>
          prev.map((it) =>
            it.skuCode === partial.skuCode ? { ...it, quantity: it.quantity + 1 } : it
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
      const promoItem =
        promoItems.find((p) => p.skuCode && p.skuCode === partial.skuCode) ??
        (partial.seriesId
          ? promoItems.find((p) => p.seriesId && p.seriesId === partial.seriesId)
          : undefined)

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
      // 使用 /api/products/sku/[skuCode] 查 Notion 中的實際售價（rich.price）。
      // 查到後：若有促銷條件 → 以實際定價重新套折扣；否則直接更新單價。
      if ((partial.unitPrice ?? 0) === 0 && partial.skuCode) {
        fetch(`/api/products/sku/${encodeURIComponent(partial.skuCode)}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data: { rich?: { price?: number | null } } | null) => {
            const actualPrice = data?.rich?.price ?? 0
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

      const promoItem =
        promoItems.find((p) => p.skuCode && p.skuCode === item.skuCode) ??
        (item.seriesId ? promoItems.find((p) => p.seriesId && p.seriesId === item.seriesId) : undefined)
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

  // Save
  const handleSave = async (targetStatus: string) => {
    if (!salesperson.trim()) {
      setError('請填寫業務姓名')
      return
    }
    if (items.length === 0) {
      setError('請至少新增一個品項')
      return
    }
    // 跨規格系列買N送M：門檻已達但未加入贈品，不允許儲存
    for (const [seriesId, s] of Object.entries(seriesBuyNGetMStatus)) {
      if (s.freeQty <= 0) continue
      const giftCount = items.filter(
        it => it.seriesId === seriesId && (it.itemType === 'gift' || it.itemType === 'sample')
      ).reduce((sum, it) => sum + (it.quantity || 1), 0)
      if (giftCount < s.freeQty) {
        setError(
          `「${s.seriesName}」買${s.n}送${s.m}門檻已達，` +
          `請加入 ${s.freeQty} 件贈品（目前 ${giftCount} 件）後再儲存`
        )
        return
      }
    }
    setError('')
    setSaving(true)

    try {
      const customerPayload = {
        customerId: customer.id,
        customerName: customer.name,
        companyTitle: customer.companyTitle,
        customerAddress: customer.address,
        customerPhone: customer.phone,
        contactPerson: customer.contactPerson,
        customerTaxId: customer.taxId,
      }
      const body = JSON.stringify({ date, salesperson, note, items, status: targetStatus, ...customerPayload, promotionId, promotionName })
      const res = isEdit && initialOrder
        ? await fetch(`/api/orders/${initialOrder.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
          })
        : await fetch('/api/orders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `伺服器錯誤 (${res.status})`)
      }

      router.push('/orders')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  // Print
  const handlePrint = () => {
    const html = buildPrintHtml({ orderNumber: initialOrder?.orderNumber ?? '草稿', date, salesperson, note, status, items, customer })
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (doc) { doc.open(); doc.write(html); doc.close() }
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 2000)
    }, 500)
  }

  const totalQty = items.reduce((acc, it) => acc + it.quantity, 0)
  const totalAmount = calcTotal(items)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header info */}
      <div className="bg-white border rounded-lg p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-start gap-3">
          {isEdit && (
            <div className="col-span-1">
              <label className="block text-xs text-gray-500 mb-1">訂單編號</label>
              <span className="font-mono text-sm font-semibold text-gray-700">{initialOrder?.orderNumber}</span>
            </div>
          )}
          <div className="col-span-1">
            <label className="block text-xs text-gray-500 mb-1">訂貨日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded px-3 py-2 sm:py-1.5 text-sm w-full sm:w-[8.5rem] focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="col-span-1">
            <label className="block text-xs text-gray-500 mb-1">業務姓名 *</label>
            {salespersonOptions.length > 0 ? (
              <select
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                className="border rounded px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full sm:w-32"
              >
                <option value="">請選擇</option>
                {salespersonOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="輸入姓名"
                className="border rounded px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full sm:w-32"
              />
            )}
          </div>
          {isEdit && (
            <div className="col-span-1">
              <label className="block text-xs text-gray-500 mb-1">狀態</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border rounded px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full sm:w-auto"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="col-span-2 sm:flex-1 sm:min-w-0">
            <label className="block text-xs text-gray-500 mb-1">備註</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="訂單備註（選填）"
              className="w-full border rounded px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* Promotion selector */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">關聯促銷活動</label>
            <select
              value={promotionId}
              onChange={(e) => {
                const id = e.target.value
                const promo = activePromos.find((p) => p.id === id)
                setPromotionId(id)
                setPromotionName(promo?.name ?? '')
                // 自動帶入備註：若備註空白或是上次自動帶入的促銷備註，覆蓋之
                setNote((prev) => {
                  if (!promo) return prev.startsWith('促銷活動：') ? '' : prev
                  if (!prev.trim() || prev.startsWith('促銷活動：')) return `促銷活動：${promo.name}`
                  return prev
                })
              }}
              disabled={!canEdit}
              className="border rounded px-3 py-2 sm:py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 w-full sm:max-w-[280px]"
            >
              <option value="">— 無關聯活動 —</option>
              {activePromos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {/* If the order already has a promotion that's now ended, still show it */}
              {promotionId && !activePromos.find((p) => p.id === promotionId) && (
                <option value={promotionId}>{promotionName}</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* 客戶資訊 */}
      <div className="bg-white border rounded-lg p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">客戶資訊</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 客戶名稱：單一欄位，打字即搜尋 CRM */}
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">客戶名稱</label>
            <CustomerNameInput customer={customer} onChange={setCustomer} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">聯絡人</label>
            <input
              type="text"
              value={customer.contactPerson}
              onChange={(e) => setCustomer((c) => ({ ...c, contactPerson: e.target.value }))}
              placeholder="聯絡人姓名（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">電話</label>
            <input
              type="text"
              value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
              placeholder="電話號碼（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">統一編號</label>
            <input
              type="text"
              value={customer.taxId}
              onChange={(e) => setCustomer((c) => ({ ...c, taxId: e.target.value }))}
              placeholder="統一編號（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              公司抬頭 <span className="text-gray-400 text-[10px]">（選填）</span>
            </label>
            <input
              type="text"
              value={customer.companyTitle}
              onChange={(e) => setCustomer((c) => ({ ...c, companyTitle: e.target.value }))}
              placeholder="如：XX 牙醫診所"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">地址</label>
            <input
              type="text"
              value={customer.address}
              onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))}
              placeholder="送貨地址（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b gap-2">
          <h2 className="font-semibold text-gray-800 min-w-0 truncate">
            訂貨品項
            {items.length > 0 && (
              <span className="ml-1.5 text-[12px] sm:text-sm font-normal text-gray-400 whitespace-nowrap">
                {items.length} 種 · 共 {totalQty} 件
              </span>
            )}
          </h2>
          {canEdit && (
          <button
            onClick={() => setShowPicker(true)}
            className="button-primary px-3 sm:px-4 py-[7px] sm:py-1.5 text-[13px] sm:text-sm rounded shrink-0 whitespace-nowrap"
          >
            + 新增品項
          </button>
        )}
        </div>

        {/* ── 跨規格系列買N送M 進度 banner ── */}
        {Object.values(seriesBuyNGetMStatus).map(({ seriesName, n, m, totalQty, freeQty }) => {
          const pct     = Math.min(100, Math.round((totalQty % n || (totalQty > 0 ? n : 0)) / n * 100))
          const reached = freeQty > 0
          return (
            <div
              key={seriesName}
              className={`mx-4 sm:mx-5 my-3 rounded-xl border px-4 py-3 text-sm ${
                reached
                  ? 'bg-teal-50 border-teal-200 text-teal-800'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <span className="font-medium">
                  {reached ? '🎁' : '🏷'} {seriesName}
                  <span className="ml-2 font-normal text-xs opacity-70">買{n}送{m}（跨規格合計）</span>
                </span>
                <span className={`text-xs font-semibold ${reached ? 'text-teal-700' : 'text-gray-500'}`}>
                  {totalQty} / {n} 件
                  {freeQty > 0 && ` → 可自選 ${freeQty} 件贈品`}
                </span>
              </div>
              {/* progress bar */}
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${reached ? 'bg-teal-400' : 'bg-gray-400'}`}
                  style={{ width: `${totalQty === 0 ? 0 : Math.min(100, (totalQty / n) * 100)}%` }}
                />
              </div>
              {reached && (
                <p className="mt-1.5 text-xs text-teal-600">
                  ✓ 門檻已達，請在品項中手動加入贈品（類型選「贈品」）
                </p>
              )}
            </div>
          )
        })}

        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-12 sm:py-16">
            <div className="text-3xl mb-2">📦</div>
            <div className="text-sm">尚未新增品項，點擊「新增品項」開始選擇</div>
          </div>
        ) : (
          <>
            {/* ── 手機 / 平板卡片版（< md）── */}
            <div className="md:hidden divide-y">
              {items.map((item, idx) => {
                const type    = (item.itemType ?? 'normal') as ItemType
                const isGift  = type === 'gift' || type === 'sample'
                const qty     = Math.max(1, item.quantity || 1)
                const price   = isGift ? 0 : (item.unitPrice || 0)
                const lineAmt = qty * price
                const hint    = promoHints[item.id]
                return (
                  <div key={item.id} className={`p-4 space-y-3 ${isGift ? 'bg-green-50/40' : ''}`}>

                    {/* 品名 row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] text-gray-400 shrink-0">{idx + 1}.</span>
                          <span className="font-semibold text-gray-800 text-sm leading-snug">{item.skuName}</span>
                        </div>
                        {(item.skuCode || item.brand) && (
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                            {[item.skuCode, item.brand].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      {canEdit && (
                        <button onClick={() => removeItem(item.id)}
                          className="text-gray-300 hover:text-red-400 text-2xl leading-none shrink-0 -mt-0.5 px-1">×</button>
                      )}
                    </div>

                    {/* 促銷 hint — 明顯色塊 */}
                    {hint && (
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <span className="text-base leading-none">⚡</span>
                        <span>{hint}</span>
                      </div>
                    )}

                    {/* 類型 + 數量 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 mb-1">類型</label>
                        <select
                          value={type}
                          onChange={(e) => {
                            const next = e.target.value as ItemType
                            updateItem(item.id, {
                              itemType:  next,
                              unitPrice: next === 'gift' || next === 'sample' ? 0 : item.unitPrice,
                            })
                          }}
                          disabled={!canEdit}
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-80 ${ITEM_TYPE_COLOR[type]}`}
                        >
                          <option value="normal">一般</option>
                          <option value="gift">贈品</option>
                          <option value="sample">樣品</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 mb-1">數量</label>
                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (!isGift) handleQtyChange(item, Math.max(1, qty - 1))
                                else updateItem(item.id, { quantity: Math.max(1, qty - 1) })
                              }}
                              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-base leading-none"
                            >−</button>
                            <input
                              type="number"
                              min={1}
                              value={qty}
                              onChange={(e) => {
                                const v = Math.max(1, parseInt(e.target.value) || 1)
                                if (!isGift) handleQtyChange(item, v)
                                else updateItem(item.id, { quantity: v })
                              }}
                              className="w-12 text-center border rounded-lg px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <button
                              onClick={() => {
                                if (!isGift) handleQtyChange(item, qty + 1)
                                else updateItem(item.id, { quantity: qty + 1 })
                              }}
                              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-base leading-none"
                            >+</button>
                          </div>
                        ) : (
                          <span className="text-sm font-semibold text-gray-700">{qty} 件</span>
                        )}
                      </div>
                    </div>

                    {/* 單價 + 小計 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 mb-1">單價</label>
                        {isGift ? (
                          <span className="text-sm text-green-600 font-medium">$0</span>
                        ) : canEdit ? (
                          <input
                            type="number"
                            min={0}
                            value={price > 0 ? price : ''}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value)
                              updateItem(item.id, { unitPrice: isFinite(v) && v >= 0 ? v : 0 })
                            }}
                            placeholder="—"
                            className="w-full border-b border-dashed border-gray-300 text-sm py-0.5 focus:outline-none focus:border-blue-400 bg-transparent"
                          />
                        ) : (
                          <span className="text-sm text-gray-700">{price > 0 ? price.toLocaleString() : '—'}</span>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-400 mb-1">小計</label>
                        {isGift
                          ? <span className="text-sm text-green-500 font-medium">贈送</span>
                          : price > 0
                            ? <span className="text-sm font-bold tabular-nums text-gray-800">{lineAmt.toLocaleString()}</span>
                            : <span className="text-sm text-gray-300">—</span>
                        }
                      </div>
                    </div>

                    {/* 備註 */}
                    {canEdit ? (
                      <input
                        type="text"
                        value={item.note ?? ''}
                        onChange={(e) => updateItem(item.id, { note: e.target.value })}
                        placeholder="品項備註（選填）"
                        className="w-full border-b border-dashed border-gray-200 text-sm py-1 focus:outline-none focus:border-blue-400 bg-transparent text-gray-600 placeholder:text-gray-300"
                      />
                    ) : item.note ? (
                      <p className="text-xs text-gray-400">{item.note}</p>
                    ) : null}
                  </div>
                )
              })}

              {/* 手機合計 */}
              {totalAmount > 0 && (
                <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-t-2">
                  <span className="text-sm text-gray-600 font-medium">合計（不含贈品）</span>
                  <span className="text-sm font-bold tabular-nums text-gray-800">{totalAmount.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* ── 桌機表格版（md+）── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left w-8">#</th>
                    <th className="px-3 py-2.5 text-left">貨品碼</th>
                    <th className="px-3 py-2.5 text-left">品牌</th>
                    <th className="px-3 py-2.5 text-left">品名</th>
                    <th className="px-3 py-2.5 text-center w-20">類型</th>
                    <th className="px-3 py-2.5 text-center w-24">數量</th>
                    <th className="px-3 py-2.5 text-right w-28">單價</th>
                    <th className="px-3 py-2.5 text-right w-28">金額</th>
                    <th className="px-3 py-2.5 text-left">備註</th>
                    <th className="px-3 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, idx) => {
                    const type    = (item.itemType ?? 'normal') as ItemType
                    const isGift  = type === 'gift' || type === 'sample'
                    const qty     = Math.max(1, item.quantity || 1)
                    const price   = isGift ? 0 : (item.unitPrice || 0)
                    const lineAmt = qty * price
                    return (
                      <tr key={item.id} className={isGift ? 'bg-green-50/40 hover:bg-green-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{item.skuCode}</td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{item.brand}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-800">{item.skuName}</div>
                          {promoHints[item.id] && (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                              <span>⚡</span>
                              <span>{promoHints[item.id]}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select
                            value={type}
                            onChange={(e) => {
                              const next = e.target.value as ItemType
                              updateItem(item.id, {
                                itemType:  next,
                                unitPrice: next === 'gift' || next === 'sample' ? 0 : item.unitPrice,
                              })
                            }}
                            disabled={!canEdit}
                            className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-300 ${ITEM_TYPE_COLOR[type]}`}
                          >
                            <option value="normal">一般</option>
                            <option value="gift">贈品</option>
                            <option value="sample">樣品</option>
                          </select>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                if (!isGift) handleQtyChange(item, Math.max(1, qty - 1))
                                else updateItem(item.id, { quantity: Math.max(1, qty - 1) })
                              }}
                              className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                            >−</button>
                            <input
                              type="number"
                              min={1}
                              value={qty}
                              onChange={(e) => {
                                const v = Math.max(1, parseInt(e.target.value) || 1)
                                if (!isGift) handleQtyChange(item, v)
                                else updateItem(item.id, { quantity: v })
                              }}
                              className="w-12 text-center border rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            <button
                              onClick={() => {
                                if (!isGift) handleQtyChange(item, qty + 1)
                                else updateItem(item.id, { quantity: qty + 1 })
                              }}
                              className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                            >+</button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {isGift ? (
                            <span className="block text-right text-sm text-green-600 font-medium">$0</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              value={price > 0 ? price : ''}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value)
                                updateItem(item.id, { unitPrice: isFinite(v) && v >= 0 ? v : 0 })
                              }}
                              placeholder="—"
                              className="w-full text-right border-0 border-b border-dashed border-gray-300 text-sm focus:outline-none focus:border-blue-400 bg-transparent"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm text-gray-700 tabular-nums">
                          {isGift
                            ? <span className="text-green-500 text-xs">贈送</span>
                            : price > 0
                              ? lineAmt.toLocaleString()
                              : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            value={item.note ?? ''}
                            onChange={(e) => updateItem(item.id, { note: e.target.value })}
                            placeholder="備註"
                            className="w-full border-0 border-b border-dashed border-gray-300 text-sm focus:outline-none focus:border-blue-400 bg-transparent"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-gray-300 hover:text-red-400 text-lg leading-none"
                          >×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot style={{ display: totalAmount > 0 ? '' : 'none' }}>
                  <tr className="border-t-2 bg-gray-50">
                    <td colSpan={7} className="px-3 py-2.5 text-right text-sm font-medium text-gray-600">合計（不含贈品）</td>
                    <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-800 tabular-nums">
                      {totalAmount > 0 ? totalAmount.toLocaleString() : ''}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 訂購統計 */}
      {items.length > 0 && (
        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">訂購統計</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="text-left pb-2 font-medium">品牌</th>
                  <th className="text-center pb-2 font-medium">種類</th>
                  <th className="text-center pb-2 font-medium">件數</th>
                  {totalAmount > 0 && <th className="text-right pb-2 font-medium">小計</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {Object.entries(
                  items.reduce((acc, it) => {
                    if (!acc[it.brand]) acc[it.brand] = { kinds: 0, qty: 0, amt: 0 }
                    acc[it.brand].kinds += 1
                    acc[it.brand].qty += it.quantity
                    acc[it.brand].amt += it.quantity * (it.unitPrice || 0)
                    return acc
                  }, {} as Record<string, { kinds: number; qty: number; amt: number }>)
                )
                  .sort((a, b) => b[1].qty - a[1].qty)
                  .map(([brand, stat]) => (
                    <tr key={brand} className="text-gray-700">
                      <td className="py-1.5">{brand || '—'}</td>
                      <td className="text-center py-1.5 tabular-nums">{stat.kinds} 種</td>
                      <td className="text-center py-1.5 tabular-nums font-medium">{stat.qty} 件</td>
                      {totalAmount > 0 && (
                        <td className="text-right py-1.5 tabular-nums text-gray-500">
                          {stat.amt > 0 ? stat.amt.toLocaleString() : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold text-gray-800">
                  <td className="pt-2">合計</td>
                  <td className="text-center pt-2 tabular-nums">{items.length} 種</td>
                  <td className="text-center pt-2 tabular-nums">{totalQty} 件</td>
                  {totalAmount > 0 && (
                    <td className="text-right pt-2 tabular-nums">NT$ {totalAmount.toLocaleString()}</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Footer actions */}
      {/* Action bar — sticky on mobile */}
      <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 bg-white sm:bg-transparent border-t sm:border-none shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:shadow-none flex flex-wrap items-center justify-between gap-[10px] sm:gap-3">
        {/* 左：取消 ＋ 儲存草稿 */}
        <div className="flex gap-[8px] sm:gap-2">
          <button
            onClick={() => router.back()}
            className="button-secondary px-3 sm:px-4 py-[10px] sm:py-2 text-[13px] sm:text-sm rounded"
          >
            取消
          </button>
          {canEdit && (
            <button
              onClick={() => handleSave('草稿')}
              disabled={saving}
              className="button-secondary px-3 sm:px-4 py-[10px] sm:py-2 text-[13px] sm:text-sm rounded disabled:opacity-50"
            >
              {saving ? '儲存中...' : '儲存草稿'}
            </button>
          )}
        </div>
        {/* 右：列印 ＋ 送出訂單 */}
        <div className="flex gap-[8px] sm:gap-2 flex-1 sm:flex-none justify-end">
          {items.length > 0 && (
            <button
              onClick={handlePrint}
              className="button-secondary px-3 sm:px-4 py-[10px] sm:py-2 text-[13px] sm:text-sm rounded"
            >
              🖨️ 列印
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => handleSave('已送出')}
              disabled={saving}
              className="button-primary px-3 sm:px-4 py-[10px] sm:py-2 text-[13px] sm:text-sm rounded disabled:opacity-50 flex-1 sm:flex-none"
            >
              {saving ? '送出中...' : '✓ 送出訂單'}
            </button>
          )}
          {!canEdit && (
            <span className="text-[13px] sm:text-sm text-amber-600 bg-amber-50 border border-amber-200 px-3 py-[10px] sm:py-1.5 rounded-lg">
              🔒 {lockedNote ?? '僅限閱覽，無編輯權限'}
            </span>
          )}
        </div>
      </div>

      {/* Product picker panel */}
      <AnimatePresence>
        {showPicker && (
          <ProductPicker
            onAdd={handleAddItem}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Print HTML ─────────────────────────────────────────────────

function buildPrintHtml(data: {
  orderNumber: string
  date: string
  salesperson: string
  note: string
  status: string
  items: OrderItem[]
  customer: SelectedCustomer  // includes companyTitle
}) {
  const totalQty  = data.items.reduce((a, i) => a + i.quantity, 0)
  const totalAmt  = calcTotal(data.items)
  const hasPrice  = data.items.some((i) => i.unitPrice > 0)
  const printTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })

  const rows = data.items.map((item, i) => {
    const lineTotal    = item.unitPrice > 0 ? (item.quantity * item.unitPrice).toLocaleString() : ''
    const unitPriceStr = item.unitPrice > 0 ? item.unitPrice.toLocaleString() : ''
    return `<tr>
      <td class="tc gray">${i + 1}</td>
      <td class="mono sm">${item.skuCode}</td>
      <td class="sm">${item.brand}</td>
      <td class="bold">${item.skuName}</td>
      <td class="tc">${item.quantity}</td>
      ${hasPrice ? `<td class="tr">${unitPriceStr}</td><td class="tr bold">${lineTotal}</td>` : ''}
      <td class="sm gray">${item.note || ''}</td>
    </tr>`
  }).join('')

  const totalRow = hasPrice ? `
    <tr class="total-row">
      <td colspan="4" class="tr" style="padding-right:12px">小計</td>
      <td class="tc">${totalQty}</td>
      <td></td>
      <td class="tr bold" style="font-size:14px">${totalAmt.toLocaleString()}</td>
      <td></td>
    </tr>` : `
    <tr class="total-row">
      <td colspan="4" class="tr" style="padding-right:12px">總數量</td>
      <td class="tc bold">${totalQty}</td>
      <td></td>
    </tr>`

  const c = data.customer

  return `<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8">
<title>訂貨單 ${data.orderNumber}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:12px;color:#111;background:#fff;padding:28px 32px 40px}
  .hd{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:14px;border-bottom:2px solid #111}
  .co{font-size:18px;font-weight:700;letter-spacing:0.02em;line-height:1.3}
  .co-sub{font-size:10px;color:#777;margin-top:2px;letter-spacing:0.06em}
  .doc-meta{text-align:right}
  .doc-type{font-size:10px;color:#777;letter-spacing:0.08em;margin-bottom:4px}
  .doc-num{font-size:22px;font-weight:700;font-family:monospace;letter-spacing:0.06em}
  /* ── 訂單資訊列 ── */
  .info{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #ddd;background:#f8f8f8}
  .info-cell{padding:6px 12px}
  .lbl{font-size:9px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px}
  .val{font-size:12px;font-weight:500;color:#111}
  /* ── 客戶區塊 ── */
  .cust-block{border:1px solid #ddd;border-top:none;background:#fff}
  .cust-title{background:#333;color:#fff;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:4px 12px;text-transform:uppercase}
  .cust-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:0}
  .cust-cell{padding:6px 12px;border-right:1px solid #eee}
  .cust-cell:last-child{border-right:none}
  .cust-name-val{font-size:14px;font-weight:700;color:#111}
  .cust-addr{border-top:1px solid #eee;padding:6px 12px}
  /* ── 品項表格 ── */
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
  th{background:#111;color:#fff;font-weight:600;text-align:left;padding:7px 8px;font-size:10px;letter-spacing:0.04em;white-space:nowrap}
  td{padding:6px 8px;border-bottom:1px solid #e8e8e8}
  tbody tr:nth-child(even) td{background:#f8f8f8}
  .total-row td{background:#333!important;color:#fff;font-weight:600;padding:7px 8px;border:none}
  .tc{text-align:center}.tr{text-align:right}.bold{font-weight:600}
  .mono{font-family:monospace;font-size:10px;color:#666}.sm{font-size:11px}.gray{color:#999}
  .ft{display:flex;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1px solid #ddd;font-size:10px;color:#aaa}
  .sig{display:flex;gap:40px;margin-top:40px}
  .sig-item{min-width:100px;border-top:1px solid #bbb;padding-top:4px;font-size:10px;color:#888}
  @media print{body{padding:0}}
</style>
</head>
<body>

<!-- Header -->
<div class="hd">
  <div>
    <div class="co">崧達企業股份有限公司</div>
    <div class="co-sub">SONGTAH TRADING CO., LTD.</div>
  </div>
  <div class="doc-meta">
    <div class="doc-type">內部訂貨單 PURCHASE ORDER</div>
    <div class="doc-num">${data.orderNumber}</div>
  </div>
</div>

<!-- 訂單資訊列 -->
<div class="info">
  <div class="info-cell"><div class="lbl">訂貨日期</div><div class="val">${data.date || '—'}</div></div>
  <div class="info-cell"><div class="lbl">業務</div><div class="val">${data.salesperson || '—'}</div></div>
  <div class="info-cell"><div class="lbl">狀態</div><div class="val">${data.status || '—'}</div></div>
  <div class="info-cell"><div class="lbl">備注</div><div class="val">${data.note || '—'}</div></div>
</div>

<!-- 客戶資訊（永遠顯示） -->
<div class="cust-block">
  <div class="cust-title">收貨客戶資訊</div>
  <div class="cust-grid">
    <div class="cust-cell">
      <div class="lbl">客戶名稱</div>
      <div class="cust-name-val">${c.name || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">公司抬頭</div>
      <div class="val">${c.companyTitle || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">聯絡人</div>
      <div class="val">${c.contactPerson || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">電話</div>
      <div class="val">${c.phone || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">統一編號</div>
      <div class="val">${c.taxId || '—'}</div>
    </div>
  </div>
  <div class="cust-addr">
    <div class="lbl">地址</div>
    <div class="val">${c.address || '—'}</div>
  </div>
</div>

<!-- Items table -->
<table>
  <thead>
    <tr>
      <th style="width:24px;text-align:center">#</th>
      <th>貨品代碼</th>
      <th>品牌</th>
      <th>品名</th>
      <th style="text-align:center;width:44px">數量</th>
      ${hasPrice ? '<th style="text-align:right;width:72px">單價</th><th style="text-align:right;width:80px">金額</th>' : ''}
      <th>備註</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  ${totalRow}
</table>

<div class="ft">
  <span>共 ${data.items.length} 種品項・總數量 ${totalQty} 件${hasPrice ? `・合計 NT$ ${totalAmt.toLocaleString()}` : ''}</span>
  <span>列印：${printTime}</span>
</div>

<div class="sig">
  <div class="sig-item">訂貨人</div>
  <div class="sig-item">核准</div>
  <div class="sig-item">收貨確認</div>
</div>

</body></html>`
}
