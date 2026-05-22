'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { OrderItem } from '@/lib/orders-notion'

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
}

interface SeriesEntry {
  id: string
  brand: string
  name: string
  type: string
  mode: '直接選品項' | '選擇式規格'
  skus: SkuEntry[]
  specs?: Array<{ name: string; options: string[]; order: number }>
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

// ── 規格欄位定義（從 SKU 欄位名 → 中文顯示名） ───────────────

const SPEC_FIELDS: Array<{ key: keyof SkuEntry; label: string }> = [
  { key: 'material',  label: '材質' },
  { key: 'colorOpt',  label: '顏色' },
  { key: 'color',     label: '色號' },
  { key: 'size',      label: '尺寸/高度' },
  { key: 'weight',    label: '容量/重量' },
  { key: 'model',     label: '型號' },
]

/** 從 SKU 列表計算哪些規格欄位有 2+ 個不同值（才值得顯示篩選器） */
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

/** 用規格篩選 SKU */
function filterSkusBySpecs(skus: SkuEntry[], selected: Record<string, string>) {
  return skus.filter((sku) =>
    Object.entries(selected).every(([key, val]) => {
      if (!val) return true
      return ((sku[key as keyof SkuEntry] as string | undefined) ?? '') === val
    })
  )
}

// ── SeriesPanel（展開後顯示規格篩選 + SKU 列表） ──────────────

function SeriesPanel({
  series,
  onAdd,
}: {
  series: SeriesEntry
  onAdd: (series: SeriesEntry, sku: SkuEntry) => void
}) {
  const specFilters = useMemo(() => computeSpecFilters(series.skus), [series.skus])
  // 初始 selected：每個 spec 預設空字串（全部）
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(specFilters.map((f) => [f.key, '']))
  )

  const filteredSkus = useMemo(
    () => filterSkusBySpecs(series.skus, selected),
    [series.skus, selected]
  )

  const showSpecFilters = series.mode === '選擇式規格' && specFilters.length > 0

  return (
    <div className="bg-gray-50 border-t border-gray-100">
      {/* 規格篩選區 */}
      {showSpecFilters && (
        <div className="px-5 py-3 space-y-2 border-b border-gray-200 bg-blue-50/50">
          <div className="text-xs font-medium text-blue-700 mb-1.5">選擇規格</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {specFilters.map((f) => (
              <div key={f.key} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 whitespace-nowrap">{f.label}</span>
                <select
                  value={selected[f.key] ?? ''}
                  onChange={(e) =>
                    setSelected((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  className="border rounded px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">全部</option>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {filteredSkus.length === 0 && (
            <div className="text-xs text-gray-400 pt-1">無符合規格的品項</div>
          )}
          {filteredSkus.length > 0 && (
            <div className="text-xs text-gray-400">
              符合 {filteredSkus.length} 項
            </div>
          )}
        </div>
      )}

      {/* SKU 列表 */}
      <div className="divide-y divide-gray-100">
        {filteredSkus.map((sku) => (
          <div
            key={sku.code}
            className="flex items-center gap-3 px-5 py-2.5 hover:bg-blue-50"
          >
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
  const types = useMemo(
    () => Array.from(new Set(catalog.map((s) => s.type))).sort(),
    [catalog]
  )

  const searchLower = search.toLowerCase()
  const isSearching = search.trim().length > 0

  const filteredSeries = useMemo(() => {
    return catalog.filter((s) => {
      if (filterBrand && s.brand !== filterBrand) return false
      if (filterType && s.type !== filterType) return false
      if (!isSearching) return true
      if (s.name.toLowerCase().includes(searchLower)) return true
      return s.skus.some(
        (sku) =>
          sku.name.toLowerCase().includes(searchLower) ||
          sku.code.toLowerCase().includes(searchLower)
      )
    })
  }, [catalog, filterBrand, filterType, searchLower, isSearching])

  // 搜尋結果：展開到 SKU 層
  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const results: Array<{ series: SeriesEntry; sku: SkuEntry }> = []
    for (const s of filteredSeries) {
      for (const sku of s.skus) {
        if (
          sku.name.toLowerCase().includes(searchLower) ||
          sku.code.toLowerCase().includes(searchLower) ||
          s.name.toLowerCase().includes(searchLower)
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
      })
    },
    [onAdd]
  )

  const toggleSeries = useCallback((id: string) => {
    setExpandedSeries((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-base font-semibold">選擇品項</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
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
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
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
                  const hasSpecFilter =
                    series.mode === '選擇式規格' &&
                    computeSpecFilters(series.skus).length > 0
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
        <div className="px-4 py-2 border-t text-xs text-gray-400 text-center">
          {isSearching
            ? `搜尋結果 ${searchResults.length} 項`
            : `共 ${filteredSeries.length} 個系列`}
        </div>
      </div>
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
  }
}

export default function OrderForm({ initialOrder }: OrderFormProps) {
  const router = useRouter()
  const isEdit = !!initialOrder

  // Form state
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [date, setDate] = useState(initialOrder?.date ?? today)
  const [salesperson, setSalesperson] = useState(initialOrder?.salesperson ?? '')
  const [note, setNote] = useState(initialOrder?.note ?? '')
  const [status, setStatus] = useState<string>(initialOrder?.status ?? '草稿')
  const [items, setItems] = useState<OrderItem[]>(initialOrder?.items ?? [])
  const [showPicker, setShowPicker] = useState(false)
  const [catalog, setCatalog] = useState<SeriesEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load product catalog
  useEffect(() => {
    fetch('/products_catalog.json')
      .then((r) => r.json())
      .then((data) => {
        setCatalog(data)
        setCatalogLoading(false)
      })
      .catch(() => setCatalogLoading(false))
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
      if (isEdit && initialOrder) {
        await fetch(`/api/orders/${initialOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, salesperson, note, items, status: targetStatus }),
        })
      } else {
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, salesperson, note, items, status: targetStatus }),
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
    const html = buildPrintHtml({ orderNumber: initialOrder?.orderNumber ?? '(未儲存)', date, salesperson, note, status, items })
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
            <input
              type="text"
              value={salesperson}
              onChange={(e) => setSalesperson(e.target.value)}
              placeholder="輸入姓名"
              className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
            />
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
                  <th className="px-4 py-2.5 text-left w-8">#</th>
                  <th className="px-3 py-2.5 text-left">品牌</th>
                  <th className="px-3 py-2.5 text-left">系列</th>
                  <th className="px-3 py-2.5 text-left">品名</th>
                  <th className="px-3 py-2.5 text-left">貨品碼</th>
                  <th className="px-3 py-2.5 text-center w-24">數量</th>
                  <th className="px-3 py-2.5 text-left">備註</th>
                  <th className="px-3 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{item.brand}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{item.seriesName}</td>
                    <td className="px-3 py-2.5 text-gray-800 font-medium">{item.skuName}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{item.skuCode}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => updateItem(item.id, { quantity: Math.max(1, item.quantity - 1) })}
                          className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-12 text-center border rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}
                          className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={item.note}
                        onChange={(e) => updateItem(item.id, { note: e.target.value })}
                        placeholder="備註"
                        className="w-full border-0 border-b border-dashed border-gray-300 text-sm focus:outline-none focus:border-blue-400 bg-transparent"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-gray-300 hover:text-red-400 text-lg leading-none"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
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
      {showPicker && catalog.length > 0 && (
        <ProductPicker
          catalog={catalog}
          onAdd={handleAddItem}
          onClose={() => setShowPicker(false)}
        />
      )}
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
}) {
  const rows = data.items.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${item.brand}</td>
      <td>${item.seriesName}</td>
      <td>${item.skuName}</td>
      <td>${item.skuCode}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td>${item.note}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>訂貨單 ${data.orderNumber}</title>
  <style>
    body { font-family: 'Noto Sans TC', sans-serif; margin: 20mm; font-size: 12px; color: #222; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .meta { margin-bottom: 16px; color: #555; }
    .meta span { margin-right: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #f5f5f5; font-weight: 600; text-align: left; padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; }
    td { padding: 5px 8px; border: 1px solid #ddd; }
    tr:nth-child(even) td { background: #fafafa; }
    .footer { margin-top: 24px; color: #888; font-size: 11px; }
  </style>
  </head><body>
  <h1>崧達企業 訂貨單</h1>
  <div class="meta">
    <span>訂單編號：<strong>${data.orderNumber}</strong></span>
    <span>日期：${data.date}</span>
    <span>業務：${data.salesperson}</span>
    <span>狀態：${data.status}</span>
    ${data.note ? `<span>備註：${data.note}</span>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>品牌</th><th>系列</th><th>品名</th><th>貨品碼</th><th>數量</th><th>備註</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">共 ${data.items.length} 種品項・總數量 ${data.items.reduce((a, i) => a + i.quantity, 0)} 件</div>
  </body></html>`
}
