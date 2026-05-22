'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { OrderItem } from '@/lib/orders-notion'

// Inline to avoid importing server-side Notion client in the browser bundle
const calcTotal = (items: OrderItem[]): number =>
  items.reduce((sum, it) => sum + it.quantity * (it.unitPrice || 0), 0)

// ── 產品目錄型別 ──────────────────────────────────────────────

interface SkuEntry {
  code: string
  name: string
  color?: string
  size?: string
  weight?: string
  material?: string
  colorOpt?: string
  model?: string
  summary?: string
  specValues?: Record<string, string>   // chip-based spec selection
}

interface SeriesSpec {
  name: string
  options: string[]
  order: number
}

interface SeriesEntry {
  id: string
  brand: string
  name: string
  type: string
  mode: '直接選品項' | '選擇式規格'
  skus: SkuEntry[]
  specs?: SeriesSpec[]
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

// ── 規格欄位定義（舊式 dropdown 用） ──────────────────────────

const SPEC_FIELDS: Array<{ key: keyof SkuEntry; label: string }> = [
  { key: 'material',  label: '材質' },
  { key: 'colorOpt',  label: '顏色' },
  { key: 'color',     label: '色號' },
  { key: 'size',      label: '尺寸/高度' },
  { key: 'weight',    label: '容量/重量' },
  { key: 'model',     label: '型號' },
]

function computeSpecFilters(skus: SkuEntry[]) {
  const result: Array<{ key: keyof SkuEntry; label: string; options: string[] }> = []
  for (const { key, label } of SPEC_FIELDS) {
    const vals = Array.from(
      new Set(skus.map((s) => (s[key] as string | undefined) ?? '').filter(Boolean))
    ).sort()
    if (vals.length >= 2) result.push({ key, label, options: vals })
  }
  return result
}

function filterSkusBySpecs(skus: SkuEntry[], selected: Record<string, string>) {
  return skus.filter((sku) =>
    Object.entries(selected).every(([key, val]) => {
      if (!val) return true
      return ((sku[key as keyof SkuEntry] as string | undefined) ?? '') === val
    })
  )
}

// ── ChipSpecPanel（新式串聯卡片規格選擇） ─────────────────────

function ChipSpecPanel({
  series,
  onAdd,
}: {
  series: SeriesEntry
  onAdd: (series: SeriesEntry, sku: SkuEntry) => void
}) {
  const specs = useMemo(
    () => [...(series.specs ?? [])].sort((a, b) => a.order - b.order),
    [series.specs]
  )
  const [selected, setSelected] = useState<Record<string, string>>({})

  // For spec at index i, get the options available given previous selections
  const availableOptions = useCallback(
    (specIndex: number): string[] => {
      const spec = specs[specIndex]
      if (!spec) return []
      const filtered = series.skus.filter((sku) =>
        specs.slice(0, specIndex).every(
          (prev) => !selected[prev.name] || sku.specValues?.[prev.name] === selected[prev.name]
        )
      )
      const have = new Set(filtered.map((s) => s.specValues?.[spec.name] ?? '').filter(Boolean))
      return spec.options.filter((o) => have.has(o))
    },
    [series.skus, specs, selected]
  )

  const handleChip = (specIndex: number, specName: string, value: string) => {
    setSelected((prev) => {
      const next: Record<string, string> = {}
      // Keep selections before this level, set this level, clear subsequent
      specs.slice(0, specIndex).forEach((s) => { if (prev[s.name]) next[s.name] = prev[s.name] })
      next[specName] = prev[specName] === value ? '' : value  // toggle
      return next
    })
  }

  const allSelected = specs.length > 0 && specs.every((s) => !!selected[s.name])
  const matchedSku = allSelected
    ? series.skus.find((sku) =>
        specs.every((s) => sku.specValues?.[s.name] === selected[s.name])
      )
    : null

  return (
    <div className="border-t border-gray-100 bg-stone-50 px-5 py-4 space-y-4">
      {specs.map((spec, idx) => {
        const prevSelected = idx === 0 || !!selected[specs[idx - 1].name]
        const opts = availableOptions(idx)
        return (
          <div key={spec.name}>
            <div className="text-xs font-semibold text-brand-600 mb-2">{spec.name}</div>
            <div className="flex flex-wrap gap-1.5">
              {(prevSelected ? opts : spec.options).map((opt) => {
                const isSelected = selected[spec.name] === opt
                const isAvailable = prevSelected && opts.includes(opt)
                return (
                  <button
                    key={opt}
                    disabled={!isAvailable}
                    onClick={() => handleChip(idx, spec.name, opt)}
                    className={[
                      'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                      isSelected
                        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                        : isAvailable
                          ? 'bg-white border-gray-300 text-gray-700 hover:border-brand-400 hover:text-brand-600'
                          : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 結果區 */}
      <div className="pt-1">
        {allSelected && matchedSku && (
          <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-brand-200 px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{matchedSku.name}</div>
              <div className="text-xs text-gray-400 font-mono">{matchedSku.code}</div>
            </div>
            <button
              onClick={() => { onAdd(series, matchedSku); setSelected({}) }}
              className="shrink-0 bg-brand-500 text-white text-sm font-medium px-4 py-1.5 rounded-full hover:bg-brand-600 transition-colors"
            >
              + 加入
            </button>
          </div>
        )}
        {allSelected && !matchedSku && (
          <div className="text-xs text-red-400 bg-red-50 rounded-lg px-3 py-2">
            此規格組合無對應品項
          </div>
        )}
        {!allSelected && specs.length > 0 && (
          <div className="text-xs text-gray-400">
            請選擇{specs.find((s) => !selected[s.name])?.name}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SeriesPanel（分流：chip 卡片 or 舊式列表） ────────────────

function SeriesPanel({
  series,
  onAdd,
}: {
  series: SeriesEntry
  onAdd: (series: SeriesEntry, sku: SkuEntry) => void
}) {
  // Use chip UI when series has specValues in SKUs
  const useChips = series.mode === '選擇式規格' &&
    (series.specs?.length ?? 0) > 0 &&
    series.skus.some((s) => s.specValues && Object.keys(s.specValues).length > 0)

  if (useChips) {
    return <ChipSpecPanel series={series} onAdd={onAdd} />
  }

  // ── 舊式：dropdown 篩選 + SKU 列表 ──
  const specFilters = computeSpecFilters(series.skus)
  return <LegacySpecPanel series={series} onAdd={onAdd} specFilters={specFilters} />
}

function LegacySpecPanel({
  series,
  onAdd,
  specFilters,
}: {
  series: SeriesEntry
  onAdd: (series: SeriesEntry, sku: SkuEntry) => void
  specFilters: Array<{ key: keyof SkuEntry; label: string; options: string[] }>
}) {
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(specFilters.map((f) => [f.key, '']))
  )
  const filteredSkus = useMemo(
    () => filterSkusBySpecs(series.skus, selected),
    [series.skus, selected]
  )
  const showFilters = series.mode === '選擇式規格' && specFilters.length > 0

  return (
    <div className="bg-gray-50 border-t border-gray-100">
      {showFilters && (
        <div className="px-5 py-3 space-y-2 border-b border-gray-200 bg-blue-50/50">
          <div className="text-xs font-medium text-blue-700 mb-1.5">選擇規格</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {specFilters.map((f) => (
              <div key={String(f.key)} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 whitespace-nowrap">{f.label}</span>
                <select
                  value={selected[f.key] ?? ''}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="border rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">全部</option>
                  {f.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400">
            {filteredSkus.length === 0 ? '無符合規格的品項' : `符合 ${filteredSkus.length} 項`}
          </div>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {filteredSkus.map((sku) => (
          <div key={sku.code} className="flex items-center gap-3 px-5 py-2.5 hover:bg-blue-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-800">{sku.name}</div>
              <div className="text-xs text-gray-400 flex gap-2 flex-wrap mt-0.5">
                <span className="font-mono">{sku.code}</span>
                {sku.summary && <span>{sku.summary}</span>}
              </div>
            </div>
            <button
              onClick={() => onAdd(series, sku)}
              className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
            >
              + 加入
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ProductPicker ─────────────────────────────────────────────

function ProductPicker({
  catalog,
  onAdd,
  onClose,
}: {
  catalog: SeriesEntry[]
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterType, setFilterType] = useState('')
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null)

  const brands = useMemo(
    () => Array.from(new Set(catalog.map((s) => s.brand))).sort(),
    [catalog]
  )

  // 品牌切換時，類型只顯示此品牌有的選項
  const availableTypes = useMemo(() => {
    const base = filterBrand ? catalog.filter((s) => s.brand === filterBrand) : catalog
    return Array.from(new Set(base.map((s) => s.type))).sort()
  }, [catalog, filterBrand])

  // 若當前選的類型在新品牌裡不存在，自動清除
  useEffect(() => {
    if (filterType && !availableTypes.includes(filterType)) {
      setFilterType('')
    }
  }, [availableTypes, filterType])

  const searchLower = search.toLowerCase()
  const isSearching = search.trim().length > 0

  // Safe lowercase helper – never crashes on null/undefined
  const lc = (v: string | null | undefined) => (v ?? '').toLowerCase()

  const filteredSeries = useMemo(() => {
    return catalog.filter((s) => {
      if (filterBrand && s.brand !== filterBrand) return false
      if (filterType && s.type !== filterType) return false
      if (!isSearching) return true
      if (lc(s.name).includes(searchLower)) return true
      return s.skus.some(
        (sku) =>
          lc(sku.name).includes(searchLower) ||
          lc(sku.code).includes(searchLower)
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, filterBrand, filterType, searchLower, isSearching])

  // 搜尋結果：展開到 SKU 層
  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const results: Array<{ series: SeriesEntry; sku: SkuEntry }> = []
    for (const s of filteredSeries) {
      for (const sku of s.skus) {
        if (
          lc(sku.name).includes(searchLower) ||
          lc(sku.code).includes(searchLower) ||
          lc(s.name).includes(searchLower)
        ) {
          results.push({ series: s, sku })
        }
      }
    }
    return results.slice(0, 120)
  }, [filteredSeries, searchLower, isSearching])

  const handleAddSku = useCallback(
    (series: SeriesEntry, sku: SkuEntry) => {
      onAdd({
        skuCode: sku.code,
        skuName: sku.name,
        brand: series.brand,
        seriesName: series.name,
        seriesId: series.id,
        unitPrice: 0,
      })
    },
    [onAdd]
  )

  const toggleSeries = useCallback((id: string) => {
    setExpandedSeries((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '85vh' }}
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

        {/* Top filters */}
        <div className="px-4 py-3 border-b space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedSeries(null) }}
            placeholder="搜尋品名、貨品編號..."
            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <div className="flex gap-2">
            <select
              value={filterBrand}
              onChange={(e) => { setFilterBrand(e.target.value); setExpandedSeries(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部品牌</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setExpandedSeries(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部類型</option>
              {availableTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            /* ── 搜尋模式：平鋪 SKU ── */
            searchResults.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">無符合品項</div>
            ) : (
              <div className="divide-y">
                {searchResults.map(({ series, sku }) => (
                  <div
                    key={`${series.id}-${sku.code}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {sku.name}
                      </div>
                      <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                        <span className="font-mono">{sku.code}</span>
                        <span>{series.brand} · {series.name}</span>
                        {sku.summary && <span>· {sku.summary}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddSku(series, sku)}
                      className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded"
                    >
                      + 加入
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* ── 瀏覽模式：系列 Accordion ── */
            filteredSeries.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">沒有符合的系列</div>
            ) : (
              <div className="divide-y">
                {filteredSeries.map((series) => {
                  const isExpanded = expandedSeries === series.id
                  // 只在此系列為規格式且有多個 SKU 時才顯示「含規格選項」提示
                  const hasSpecFilter =
                    series.mode === '選擇式規格' && series.skus.length > 1
                  return (
                    <div key={series.id}>
                      {/* Series header row */}
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                        onClick={() => toggleSeries(series.id)}
                      >
                        <span className="text-gray-400 text-xs w-4 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">
                            {series.name}
                          </div>
                          <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                            <span>{series.brand}</span>
                            <span>·</span>
                            <span>{series.type}</span>
                            <span>·</span>
                            <span>{series.skus.length} 項</span>
                            {hasSpecFilter && (
                              <span className="text-blue-400">· 含規格選項</span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Expanded: spec filters + SKU list */}
                      {isExpanded && (
                        <SeriesPanel series={series} onAdd={handleAddSku} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t rounded-b-2xl text-xs text-gray-400 text-center bg-gray-50">
          {isSearching
            ? `搜尋結果 ${searchResults.length} 項`
            : `共 ${filteredSeries.length} 個系列`}
        </div>
      </motion.div>
    </div>
  )
}

// ── CustomerSearchBox ─────────────────────────────────────────

interface CustomerResult {
  id: string
  name: string
  city: string
  address: string
}

interface SelectedCustomer {
  id: string
  name: string
  address: string
  phone: string
  contactPerson: string
}

function CustomerSearchBox({
  value,
  onChange,
}: {
  value: SelectedCustomer
  onChange: (c: SelectedCustomer) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const timerRef = useState<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useState<HTMLDivElement | null>(null)

  // Debounced search
  useEffect(() => {
    if (timerRef[0]) clearTimeout(timerRef[0])
    if (!query.trim()) { setResults([]); setOpen(false); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`)
        if (res.ok) { setResults(await res.json()); setOpen(true) }
      } catch { /* ignore */ } finally { setSearching(false) }
    }, 300)
    timerRef[0] = t
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Click-outside to close
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
    setQuery('')
    // Fetch full details (phone)
    try {
      const res = await fetch(`/api/customers/${c.id}`)
      if (res.ok) {
        const data = await res.json()
        onChange({
          id: c.id,
          name: data.customer?.name ?? c.name,
          address: data.customer?.address ?? c.address,
          phone: data.customer?.phone ?? '',
          contactPerson: value.contactPerson, // keep existing
        })
        return
      }
    } catch { /* fallback */ }
    onChange({ id: c.id, name: c.name, address: c.address, phone: '', contactPerson: value.contactPerson })
  }

  const handleClear = () => {
    onChange({ id: '', name: '', address: '', phone: '', contactPerson: value.contactPerson })
    setQuery('')
    setResults([])
  }

  // Selected state
  if (value.name) {
    return (
      <div className="flex items-start gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="font-semibold text-stone-800 text-sm">{value.name}</div>
          {value.address && <div className="text-xs text-stone-500">📍 {value.address}</div>}
          {value.phone && <div className="text-xs text-stone-500">📞 {value.phone}</div>}
        </div>
        <button
          onClick={handleClear}
          className="text-stone-400 hover:text-red-500 text-xs shrink-0 mt-0.5 transition-colors"
        >
          ✕ 清除
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={(el) => { wrapRef[0] = el }}>
      <div className="flex items-center border rounded-lg px-3 py-2 gap-2 focus-within:ring-1 focus-within:ring-blue-400 bg-white">
        <span className="text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="輸入客戶名稱搜尋..."
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400"
        />
        {searching && <span className="text-xs text-gray-400 animate-pulse">搜尋中</span>}
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
    customerAddress?: string
    customerPhone?: string
    contactPerson?: string
  }
}

export default function OrderForm({ initialOrder }: OrderFormProps) {
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
  const [catalog, setCatalog] = useState<SeriesEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 客戶資訊
  const [customer, setCustomer] = useState<SelectedCustomer>({
    id: initialOrder?.customerId ?? '',
    name: initialOrder?.customerName ?? '',
    address: initialOrder?.customerAddress ?? '',
    phone: initialOrder?.customerPhone ?? '',
    contactPerson: initialOrder?.contactPerson ?? '',
  })

  // Load product catalog + salesperson options in parallel
  useEffect(() => {
    fetch('/products_catalog.json')
      .then((r) => r.json())
      .then((data) => { setCatalog(data); setCatalogLoading(false) })
      .catch(() => setCatalogLoading(false))

    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.salespersons)) setSalespersonOptions(data.salespersons) })
      .catch(() => {})
  }, [])

  // Add item from picker
  const handleAddItem = useCallback(
    (partial: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => {
      setItems((prev) => {
        // Check if already in list
        const existing = prev.find((it) => it.skuCode === partial.skuCode)
        if (existing) {
          return prev.map((it) =>
            it.skuCode === partial.skuCode
              ? { ...it, quantity: it.quantity + 1 }
              : it
          )
        }
        return [
          ...prev,
          {
            ...partial,
            id: `item-${Date.now()}-${Math.random()}`,
            quantity: 1,
            unitPrice: 0,
            note: '',
          },
        ]
      })
    },
    []
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
  }, [])

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
    setError('')
    setSaving(true)

    try {
      const customerPayload = {
        customerId: customer.id,
        customerName: customer.name,
        customerAddress: customer.address,
        customerPhone: customer.phone,
        contactPerson: customer.contactPerson,
      }
      if (isEdit && initialOrder) {
        await fetch(`/api/orders/${initialOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, salesperson, note, items, status: targetStatus, ...customerPayload }),
        })
      } else {
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, salesperson, note, items, status: targetStatus, ...customerPayload }),
        })
      }
      router.push('/orders')
      router.refresh()
    } catch {
      setError('儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  // Print
  const handlePrint = () => {
    const html = buildPrintHtml({ orderNumber: initialOrder?.orderNumber ?? '(未儲存)', date, salesperson, note, status, items, customer })
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
      <div className="bg-white border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          {isEdit && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">訂單編號</label>
              <span className="font-mono text-sm font-semibold text-gray-700">{initialOrder?.orderNumber}</span>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">訂貨日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">業務姓名 *</label>
            {salespersonOptions.length > 0 ? (
              <select
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
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
                className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
              />
            )}
          </div>
          {isEdit && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">狀態</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-gray-500 mb-1">備註</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="訂單備註（選填）"
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>
      </div>

      {/* 客戶資訊 */}
      <div className="bg-white border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">客戶資訊</h2>
        <CustomerSearchBox
          value={customer}
          onChange={setCustomer}
        />
        {/* 聯絡人 + 補充欄（客戶選定後顯示） */}
        {(customer.name || customer.contactPerson) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">聯絡人</label>
              <input
                type="text"
                value={customer.contactPerson}
                onChange={(e) => setCustomer((c) => ({ ...c, contactPerson: e.target.value }))}
                placeholder="聯絡人姓名（選填）"
                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">電話（可修改）</label>
              <input
                type="text"
                value={customer.phone}
                onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
                placeholder="電話號碼"
                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        )}
        {/* 若尚未選客戶，僅顯示聯絡人欄位 */}
        {!customer.name && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">聯絡人（選填）</label>
            <input
              type="text"
              value={customer.contactPerson}
              onChange={(e) => setCustomer((c) => ({ ...c, contactPerson: e.target.value }))}
              placeholder="聯絡人姓名"
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-gray-800">
            訂貨品項
            {items.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                {items.length} 種 · 共 {totalQty} 件
              </span>
            )}
          </h2>
          <button
            onClick={() => setShowPicker(true)}
            disabled={catalogLoading}
            className="button-primary px-4 py-1.5 text-sm rounded disabled:opacity-50"
          >
            {catalogLoading ? '載入中...' : '+ 新增品項'}
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-3xl mb-2">📦</div>
            <div className="text-sm">尚未新增品項，點擊「新增品項」開始選擇</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left w-8">#</th>
                  <th className="px-3 py-2.5 text-left">貨品碼</th>
                  <th className="px-3 py-2.5 text-left">品牌</th>
                  <th className="px-3 py-2.5 text-left">品名</th>
                  <th className="px-3 py-2.5 text-center w-24">數量</th>
                  <th className="px-3 py-2.5 text-right w-28">單價</th>
                  <th className="px-3 py-2.5 text-right w-28">金額</th>
                  <th className="px-3 py-2.5 text-left">備註</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, idx) => {
                  const qty = Math.max(1, item.quantity || 1)
                  const price = item.unitPrice || 0
                  const lineAmt = qty * price
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{item.skuCode}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{item.brand}</td>
                      <td className="px-3 py-2.5 text-gray-800 font-medium">{item.skuName}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateItem(item.id, { quantity: Math.max(1, qty - 1) })}
                            className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                          >−</button>
                          <input
                            type="number"
                            min={1}
                            value={qty}
                            onChange={(e) => updateItem(item.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="w-12 text-center border rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button
                            onClick={() => updateItem(item.id, { quantity: qty + 1 })}
                            className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                          >+</button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
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
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-gray-700 tabular-nums">
                        {price > 0
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
                  <td colSpan={6} className="px-3 py-2.5 text-right text-sm font-medium text-gray-600">合計</td>
                  <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-800 tabular-nums">
                    {totalAmount > 0 ? totalAmount.toLocaleString() : ''}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => router.back()}
            className="button-secondary px-4 py-2 text-sm rounded"
          >
            取消
          </button>
          {isEdit && items.length > 0 && (
            <button
              onClick={handlePrint}
              className="button-secondary px-4 py-2 text-sm rounded"
            >
              🖨️ 列印
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSave('草稿')}
            disabled={saving}
            className="button-secondary px-5 py-2 text-sm rounded disabled:opacity-50"
          >
            {saving ? '儲存中...' : '儲存草稿'}
          </button>
          <button
            onClick={() => handleSave('已送出')}
            disabled={saving}
            className="button-primary px-5 py-2 text-sm rounded disabled:opacity-50"
          >
            {saving ? '送出中...' : '✓ 送出訂單'}
          </button>
        </div>
      </div>

      {/* Product picker panel */}
      <AnimatePresence>
        {showPicker && catalog.length > 0 && (
          <ProductPicker
            catalog={catalog}
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
  customer?: SelectedCustomer
}) {
  const totalQty = data.items.reduce((a, i) => a + i.quantity, 0)
  const totalAmount = calcTotal(data.items)
  const hasPrice = data.items.some((i) => i.unitPrice > 0)

  const rows = data.items.map((item, i) => {
    const lineTotal = item.unitPrice > 0
      ? (item.quantity * item.unitPrice).toLocaleString()
      : '—'
    const unitPriceStr = item.unitPrice > 0 ? item.unitPrice.toLocaleString() : '—'
    return `
    <tr>
      <td style="text-align:center;color:#888">${i + 1}</td>
      <td style="font-family:monospace;font-size:11px;color:#7a6050">${item.skuCode}</td>
      <td>${item.brand}</td>
      <td><strong>${item.skuName}</strong></td>
      <td style="text-align:center">${item.quantity}</td>
      ${hasPrice ? `<td style="text-align:right">${unitPriceStr}</td><td style="text-align:right;font-weight:600">${lineTotal}</td>` : ''}
      <td style="color:#888;font-size:11px">${item.note || ''}</td>
    </tr>`
  }).join('')

  const totalRow = hasPrice ? `
    <tr style="background:#f3ede3;font-weight:700;border-top:2px solid #b8956a">
      <td colspan="${4}" style="text-align:right;padding:6px 8px">合計</td>
      <td style="text-align:center;padding:6px 8px">${totalQty}</td>
      <td style="padding:6px 8px"></td>
      <td style="text-align:right;padding:6px 8px;color:#a07a52;font-size:14px">${totalAmount.toLocaleString()}</td>
      <td style="padding:6px 8px"></td>
    </tr>` : ''

  const priceHeaders = hasPrice
    ? '<th style="text-align:right">單價</th><th style="text-align:right">金額</th>'
    : ''

  return `<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8">
<title>訂貨單 ${data.orderNumber}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
    font-size: 12px;
    color: #3d2b1f;
    background: #fff;
    padding: 0;
  }
  /* ── Header ── */
  .print-header {
    background: linear-gradient(135deg, #b8956a 0%, #a07a52 100%);
    color: white;
    padding: 18px 28px 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .company-name { font-size: 20px; font-weight: 700; letter-spacing: 0.05em; }
  .doc-title { font-size: 13px; opacity: 0.85; margin-top: 2px; }
  .order-num { font-size: 22px; font-weight: 700; font-family: monospace; letter-spacing: 0.08em; }
  /* ── Gold line ── */
  .gold-line {
    height: 3px;
    background: linear-gradient(90deg, transparent 0%, #d4c5ab 30%, #b8956a 50%, #d4c5ab 70%, transparent 100%);
  }
  /* ── Meta grid ── */
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border-bottom: 1px solid #e8dfd0;
    background: #faf7f2;
    padding: 10px 28px;
  }
  .meta-item { padding: 4px 0; }
  .meta-label { font-size: 10px; color: #b8956a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
  .meta-value { font-size: 13px; font-weight: 500; color: #3d2b1f; }
  /* ── Table ── */
  .wrap { padding: 16px 28px 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead tr { background: linear-gradient(135deg, #b8956a 0%, #a07a52 100%); }
  th {
    color: white;
    font-weight: 600;
    text-align: left;
    padding: 7px 8px;
    font-size: 11px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  td { padding: 6px 8px; border-bottom: 1px solid #e8dfd0; font-size: 12px; }
  tbody tr:nth-child(even) td { background: #faf7f2; }
  tbody tr:hover td { background: #f3ede3; }
  /* ── Footer ── */
  .print-footer {
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid #e8dfd0;
    display: flex;
    justify-content: space-between;
    color: #a09080;
    font-size: 11px;
  }
  .sig-block { display: flex; gap: 48px; margin-top: 32px; }
  .sig-item { border-top: 1px solid #c4a87a; padding-top: 4px; min-width: 100px; font-size: 11px; color: #888; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<!-- Header -->
<div class="print-header">
  <div>
    <div class="company-name">崧達企業股份有限公司</div>
    <div class="doc-title">內部訂貨單</div>
  </div>
  <div class="order-num">${data.orderNumber}</div>
</div>
<div class="gold-line"></div>

<!-- Meta -->
<div class="meta-grid">
  <div class="meta-item">
    <div class="meta-label">訂貨日期</div>
    <div class="meta-value">${data.date}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">業務</div>
    <div class="meta-value">${data.salesperson}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">狀態</div>
    <div class="meta-value">${data.status}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">備註</div>
    <div class="meta-value">${data.note || '—'}</div>
  </div>
</div>

${data.customer?.name ? `
<!-- Customer info -->
<div style="background:#fff;border-bottom:1px solid #e8dfd0;padding:10px 28px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:0">
  <div style="padding:4px 0">
    <div style="font-size:10px;color:#b8956a;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">客戶名稱</div>
    <div style="font-size:14px;font-weight:700;color:#3d2b1f">${data.customer.name}</div>
  </div>
  <div style="padding:4px 0">
    <div style="font-size:10px;color:#b8956a;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">電話</div>
    <div style="font-size:13px;font-weight:500;color:#3d2b1f">${data.customer.phone || '—'}</div>
  </div>
  <div style="padding:4px 0">
    <div style="font-size:10px;color:#b8956a;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">聯絡人</div>
    <div style="font-size:13px;font-weight:500;color:#3d2b1f">${data.customer.contactPerson || '—'}</div>
  </div>
  <div style="padding:4px 0">
    <div style="font-size:10px;color:#b8956a;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px">地址</div>
    <div style="font-size:12px;font-weight:500;color:#3d2b1f">${data.customer.address || '—'}</div>
  </div>
</div>` : ''}

<!-- Table -->
<div class="wrap">
  <table>
    <thead>
      <tr>
        <th style="width:28px;text-align:center">#</th>
        <th>貨品代碼</th>
        <th>品牌</th>
        <th>品名</th>
        <th style="text-align:center;width:48px">數量</th>
        ${priceHeaders}
        <th>備註</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    ${totalRow}
  </table>

  <div class="print-footer">
    <span>共 ${data.items.length} 種品項・總數量 ${totalQty} 件${hasPrice ? `・合計 ${totalAmount.toLocaleString()} 元` : ''}</span>
    <span>列印時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
  </div>

  <div class="sig-block">
    <div class="sig-item">訂貨人</div>
    <div class="sig-item">核准</div>
    <div class="sig-item">收貨確認</div>
  </div>
</div>
</body></html>`
}
