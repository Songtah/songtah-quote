'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PROMOTION_TYPES,
  PROMOTION_STATUS_COLOR,
  type Promotion,
  type PromotionType,
  type PromotionStatus,
} from '@/lib/promotions-notion'
import {
  ITEM_STATUS_COLOR,
  CONDITION_TYPE_LABEL,
  type PromotionItem,
  type ItemStatus,
  type ConditionType,
  type ConditionParams,
  type QtyDiscountTier,
  type FixedSetPriceTier,
} from '@/lib/promotion-items-notion'

// ── Badges ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PromotionStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${PROMOTION_STATUS_COLOR[status]}`}>
      {status}
    </span>
  )
}

const TYPE_COLOR: Record<string, string> = {
  '季度展場': 'bg-orange-100 text-orange-700',
  '月度促銷': 'bg-blue-100   text-blue-700',
  '課程':     'bg-green-100  text-green-700',
  '其他':     'bg-gray-100   text-gray-600',
}

function TypeBadge({ type }: { type: string }) {
  if (!type) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ITEM_STATUS_COLOR[status]}`}>
      {status}
    </span>
  )
}

function fmtDate(d: string) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y}/${m}/${day}`
}

// ── Condition summary (view mode) ─────────────────────────────

function conditionSummary(params: ConditionParams | null): string | null {
  if (!params) return null
  const p = params as any
  switch (p.type) {
    case 'single_price':
      return `特價 NT$${Number(p.price).toLocaleString()}`
    case 'series_discount':
      return `全系列 ${Math.round(p.rate * 10)}折`
    case 'buy_n_get_m':
      return `買${p.n}送${p.m}`
    case 'fixed_set_price':
      return (p.tiers as FixedSetPriceTier[]).map((t) => `${t.qty}件 NT$${t.totalPrice.toLocaleString()}`).join(' / ')
    case 'qty_discount':
      return (p.tiers as QtyDiscountTier[]).map((t) =>
        `滿${t.minQty}件 ${t.rate != null ? Math.round(t.rate * 10) + '折' : `NT$${t.price}`}`
      ).join(' / ')
    case 'buy_a_get_b':
      return `買→贈 ${p.giftSkuName}×${p.giftQty}`
    case 'add_on':
      return `加購價 NT$${Number(p.addOnPrice).toLocaleString()}`
    case 'bundle':
      return `組合 ${p.bundlePrice != null ? `NT$${Number(p.bundlePrice).toLocaleString()}` : p.rate != null ? `${Math.round(p.rate * 10)}折` : ''}`
    default:
      return null
  }
}

const CONDITION_TYPE_COLOR: Record<string, string> = {
  single_price:    'bg-blue-50 text-blue-700 border-blue-200',
  series_discount: 'bg-purple-50 text-purple-700 border-purple-200',
  qty_discount:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  buy_n_get_m:     'bg-green-50 text-green-700 border-green-200',
  fixed_set_price: 'bg-teal-50 text-teal-700 border-teal-200',
  buy_a_get_b:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  add_on:          'bg-orange-50 text-orange-700 border-orange-200',
  bundle:          'bg-amber-50 text-amber-700 border-amber-200',
}

function ConditionChip({ conditionType, conditionParams }: {
  conditionType:   ConditionType | null
  conditionParams: ConditionParams | null
}) {
  if (!conditionType) return null
  const label   = CONDITION_TYPE_LABEL[conditionType] ?? conditionType
  const summary = conditionSummary(conditionParams)
  const color   = CONDITION_TYPE_COLOR[conditionType] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      <span className="opacity-60">{label}</span>
      {summary && <span>· {summary}</span>}
    </span>
  )
}

// ── Mini SKU search field (for condition params) ───────────────

interface SkuResult { skuCode: string; name: string; manufacturer: string }

function SkuSearchField({ label, value, onChange }: {
  label:    string
  value:    { skuCode: string; name: string } | null
  onChange: (r: SkuResult | null) => void
}) {
  const [q,       setQ]       = useState('')
  const [results, setResults] = useState<SkuResult[]>([])
  const [open,    setOpen]    = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}&limit=10`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
    }, 250)
  }, [q])

  if (value && !open) return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-400 mb-1">{label}</label>
      <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-gray-50">
        <span className="text-xs font-medium text-gray-800 flex-1">{value.name}</span>
        <span className="text-xs text-gray-400 font-mono">{value.skuCode}</span>
        <button type="button" onClick={() => { onChange(null); setQ('') }}
          className="text-gray-300 hover:text-red-400 text-xs transition">✕</button>
      </div>
    </div>
  )

  return (
    <div className="relative">
      <label className="block text-[11px] font-semibold text-gray-400 mb-1">{label}</label>
      <input
        type="search"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋貨號或品名…"
        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      {results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 border rounded-lg bg-white shadow-lg divide-y max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button key={r.skuCode} type="button"
              onClick={() => { onChange(r); setQ(''); setOpen(false); setResults([]) }}
              className="w-full text-left px-3 py-2 hover:bg-brand-50 transition">
              <p className="text-sm font-medium text-gray-800">{r.name}</p>
              <p className="text-xs text-gray-400 font-mono mt-0.5">{r.skuCode} · {r.manufacturer}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Condition Editor ──────────────────────────────────────────

const ALL_CONDITION_TYPES = Object.keys(CONDITION_TYPE_LABEL) as ConditionType[]

function defaultParams(type: ConditionType): ConditionParams {
  switch (type) {
    case 'single_price':    return { type, price: 0 }
    case 'series_discount': return { type, rate: 0.7 }
    case 'qty_discount':    return { type, tiers: [{ minQty: 5, rate: 0.9 }] }
    case 'buy_n_get_m':     return { type, n: 5, m: 1 }
    case 'fixed_set_price': return { type, tiers: [{ qty: 2, totalPrice: 0 }] }
    case 'buy_a_get_b':     return { type, giftSkuCode: '', giftSkuName: '', giftQty: 1 }
    case 'add_on':          return { type, addOnPrice: 0 }
    case 'bundle':          return { type, partnerSkuCode: '', partnerSkuName: '' }
    default:                return { type }
  }
}

function ConditionEditor({ conditionType, conditionParams, onChange }: {
  conditionType:    ConditionType | null
  conditionParams:  ConditionParams | null
  onChange: (type: ConditionType | null, params: ConditionParams | null) => void
}) {
  const p = conditionParams as any

  const setType = (t: ConditionType | '') => {
    if (!t) { onChange(null, null); return }
    onChange(t, defaultParams(t))
  }

  const patch = (fields: Record<string, unknown>) => {
    if (!conditionType || !conditionParams) return
    onChange(conditionType, { ...conditionParams, ...fields } as ConditionParams)
  }

  // Tier helpers for qty_discount
  const updateQtyTier = (idx: number, field: keyof QtyDiscountTier, val: string) => {
    const tiers: QtyDiscountTier[] = [...(p?.tiers ?? [])]
    tiers[idx] = { ...tiers[idx], [field]: field === 'minQty' ? parseInt(val) || 0 : parseFloat(val) || undefined } as QtyDiscountTier
    patch({ tiers })
  }
  const addQtyTier    = () => patch({ tiers: [...(p?.tiers ?? []), { minQty: 0 }] })
  const removeQtyTier = (idx: number) => patch({ tiers: (p?.tiers ?? []).filter((_: any, i: number) => i !== idx) })

  // Tier helpers for fixed_set_price
  const updateFixedTier = (idx: number, field: keyof FixedSetPriceTier, val: string) => {
    const tiers: FixedSetPriceTier[] = [...(p?.tiers ?? [])]
    tiers[idx] = { ...tiers[idx], [field]: parseInt(val) || 0 }
    patch({ tiers })
  }
  const addFixedTier    = () => patch({ tiers: [...(p?.tiers ?? []), { qty: 0, totalPrice: 0 }] })
  const removeFixedTier = (idx: number) => patch({ tiers: (p?.tiers ?? []).filter((_: any, i: number) => i !== idx) })

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-400 mb-1">條件類型</label>
        <select
          value={conditionType ?? ''}
          onChange={(e) => setType(e.target.value as ConditionType | '')}
          className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 text-gray-700"
        >
          <option value="">— 不設定結構化條件 —</option>
          {ALL_CONDITION_TYPES.map((t) => (
            <option key={t} value={t}>{CONDITION_TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {/* Type-specific inputs */}
      {conditionType === 'single_price' && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1">特價金額</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">NT$</span>
            <input type="number" min={0} value={p?.price ?? ''} onChange={(e) => patch({ price: parseFloat(e.target.value) || 0 })}
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
        </div>
      )}

      {conditionType === 'series_discount' && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1">折扣率</label>
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={100} step={5} value={Math.round((p?.rate ?? 0.7) * 100)}
              onChange={(e) => patch({ rate: (parseInt(e.target.value) || 0) / 100 })}
              className="w-24 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <span className="text-xs text-gray-500">%（例：70 = 七折）</span>
          </div>
        </div>
      )}

      {conditionType === 'buy_n_get_m' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">買 N 件</label>
            <input type="number" min={1} value={p?.n ?? ''} onChange={(e) => patch({ n: parseInt(e.target.value) || 1 })}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">送 M 件</label>
            <input type="number" min={1} value={p?.m ?? ''} onChange={(e) => patch({ m: parseInt(e.target.value) || 1 })}
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
        </div>
      )}

      {conditionType === 'fixed_set_price' && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1">固定價格方案（可多個）</label>
          <div className="space-y-2">
            {(p?.tiers as FixedSetPriceTier[] ?? []).map((tier, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input type="number" min={1} placeholder="件數" value={tier.qty || ''}
                  onChange={(e) => updateFixedTier(idx, 'qty', e.target.value)}
                  className="w-20 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-xs text-gray-400">件</span>
                <span className="text-xs text-gray-400">NT$</span>
                <input type="number" min={0} placeholder="總價" value={tier.totalPrice || ''}
                  onChange={(e) => updateFixedTier(idx, 'totalPrice', e.target.value)}
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <button type="button" onClick={() => removeFixedTier(idx)}
                  className="text-gray-300 hover:text-red-400 text-sm transition">✕</button>
              </div>
            ))}
            <button type="button" onClick={addFixedTier}
              className="text-xs text-brand-600 hover:underline font-medium">+ 新增方案</button>
          </div>
        </div>
      )}

      {conditionType === 'qty_discount' && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1">數量折扣門檻（可多階）</label>
          <div className="space-y-2">
            {(p?.tiers as QtyDiscountTier[] ?? []).map((tier, idx) => (
              <div key={idx} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">滿</span>
                <input type="number" min={1} placeholder="件數" value={tier.minQty || ''}
                  onChange={(e) => updateQtyTier(idx, 'minQty', e.target.value)}
                  className="w-16 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-xs text-gray-400">件</span>
                <input type="number" min={0} max={100} step={5} placeholder="折扣%" value={tier.rate != null ? Math.round(tier.rate * 100) : ''}
                  onChange={(e) => updateQtyTier(idx, 'rate', String((parseInt(e.target.value) || 0) / 100))}
                  className="w-16 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-xs text-gray-400">% 或單價 NT$</span>
                <input type="number" min={0} placeholder="單價" value={tier.price ?? ''}
                  onChange={(e) => updateQtyTier(idx, 'price', e.target.value)}
                  className="w-20 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <button type="button" onClick={() => removeQtyTier(idx)}
                  className="text-gray-300 hover:text-red-400 text-sm transition">✕</button>
              </div>
            ))}
            <button type="button" onClick={addQtyTier}
              className="text-xs text-brand-600 hover:underline font-medium">+ 新增門檻</button>
          </div>
        </div>
      )}

      {conditionType === 'buy_a_get_b' && (
        <>
          <SkuSearchField
            label="贈品商品"
            value={p?.giftSkuCode ? { skuCode: p.giftSkuCode, name: p.giftSkuName } : null}
            onChange={(r) => patch({ giftSkuCode: r?.skuCode ?? '', giftSkuName: r?.name ?? '' })}
          />
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">贈品數量</label>
            <input type="number" min={1} value={p?.giftQty ?? 1} onChange={(e) => patch({ giftQty: parseInt(e.target.value) || 1 })}
              className="w-24 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
        </>
      )}

      {conditionType === 'add_on' && (
        <>
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">加購價格</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">NT$</span>
              <input type="number" min={0} value={p?.addOnPrice ?? ''} onChange={(e) => patch({ addOnPrice: parseFloat(e.target.value) || 0 })}
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          </div>
          <SkuSearchField
            label="需搭配的主商品（選填）"
            value={p?.mainSkuCode ? { skuCode: p.mainSkuCode, name: p.mainSkuName ?? p.mainSkuCode } : null}
            onChange={(r) => patch({ mainSkuCode: r?.skuCode ?? undefined, mainSkuName: r?.name ?? undefined })}
          />
        </>
      )}

      {conditionType === 'bundle' && (
        <>
          <SkuSearchField
            label="搭配商品"
            value={p?.partnerSkuCode ? { skuCode: p.partnerSkuCode, name: p.partnerSkuName ?? p.partnerSkuCode } : null}
            onChange={(r) => patch({ partnerSkuCode: r?.skuCode ?? '', partnerSkuName: r?.name ?? '' })}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">組合優惠總價（擇一）</label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400">NT$</span>
                <input type="number" min={0} value={p?.bundlePrice ?? ''} onChange={(e) => patch({ bundlePrice: parseFloat(e.target.value) || undefined })}
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">或折扣率</label>
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={100} step={5} value={p?.rate != null ? Math.round(p.rate * 100) : ''}
                  onChange={(e) => patch({ rate: (parseInt(e.target.value) || 0) / 100 || undefined })}
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-xs text-gray-400">%</span>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// ── Series picker (for series-level promotion items) ──────────

interface SeriesResult {
  id:          string
  seriesCode:  string
  seriesName:  string
  brand:       string
  productType: string
  category:    string
}

function SeriesPicker({ onSelect }: { onSelect: (s: SeriesResult) => void }) {
  const [families, setFamilies] = useState<SeriesResult[]>([])
  const [q,        setQ]        = useState('')
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/products/families')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setFamilies(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = q.trim()
    ? families.filter((f) =>
        f.seriesName.toLowerCase().includes(q.toLowerCase()) ||
        f.brand.toLowerCase().includes(q.toLowerCase()) ||
        f.seriesCode.toLowerCase().includes(q.toLowerCase())
      )
    : families

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋系列名稱或品牌…"
        autoFocus
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      {loading && <p className="text-xs text-gray-400 mt-2 text-center">載入中…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-xs text-gray-400 mt-2 text-center">找不到符合的系列</p>
      )}
      {filtered.length > 0 && (
        <div className="mt-2 border rounded-lg divide-y overflow-hidden max-h-64 overflow-y-auto">
          {filtered.slice(0, 40).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelect(f)}
              className="w-full text-left px-3 py-2.5 hover:bg-brand-50 transition"
            >
              <p className="text-sm font-medium text-gray-800">{f.seriesName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{f.brand} · {f.productType}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Product search for adding items ──────────────────────────

interface SearchResult { skuCode: string; name: string; manufacturer: string; productType: string; category: string }

function ProductSearchPicker({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}&limit=20`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }, [q])

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋貨號或品名…"
        autoFocus
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      {loading && <p className="text-xs text-gray-400 mt-2 text-center">搜尋中…</p>}
      {!loading && q.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-2 text-center">找不到符合的商品</p>
      )}
      {results.length > 0 && (
        <div className="mt-2 border rounded-lg divide-y overflow-hidden max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.skuCode}
              type="button"
              onClick={() => { onSelect(r); setQ(''); setResults([]) }}
              className="w-full text-left px-3 py-2.5 hover:bg-brand-50 transition"
            >
              <p className="text-sm font-medium text-gray-800">{r.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{r.skuCode} · {r.manufacturer}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Promotion Item Row ────────────────────────────────────────

function ItemRow({ item, onUpdate, onDelete }: {
  item:     PromotionItem
  onUpdate: (id: string, patch: Partial<PromotionItem>) => void
  onDelete: (id: string) => void
}) {
  const [editing,         setEditing]         = useState(false)
  const [condition,       setCondition]       = useState(item.condition)
  const [conditionType,   setConditionType]   = useState<ConditionType | null>(item.conditionType)
  const [conditionParams, setConditionParams] = useState<ConditionParams | null>(item.conditionParams)
  const [price,           setPrice]           = useState<string>(item.price != null ? String(item.price) : '')
  const [adminNote,       setAdminNote]       = useState(item.adminNote)
  const [saving,          setSaving]          = useState(false)
  const [deleting,        setDeleting]        = useState(false)

  const handleConditionChange = (type: ConditionType | null, params: ConditionParams | null) => {
    setConditionType(type)
    setConditionParams(params)
  }

  const handleStatusChange = async (status: ItemStatus) => {
    onUpdate(item.id, { status })
    await fetch(`/api/promotion-items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  const handleSave = async () => {
    setSaving(true)
    const priceNum = price !== '' ? parseFloat(price) : null
    const patch = {
      condition,
      conditionType:   conditionType ?? undefined,
      conditionParams: conditionParams ?? undefined,
      price:           isFinite(priceNum!) ? priceNum : null,
      adminNote,
    }
    onUpdate(item.id, { ...patch, conditionType, conditionParams })
    await fetch(`/api/promotion-items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSaving(false)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!confirm(`確定移除「${item.skuName}」？`)) return
    setDeleting(true)
    await fetch(`/api/promotion-items/${item.id}`, { method: 'DELETE' })
    onDelete(item.id)
  }


  return (
    <div className={`border-b last:border-0 px-4 py-3 transition-colors ${item.status === '不採用' ? 'opacity-50' : ''}`}>
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-800">{item.skuName}</span>
            {item.seriesId
              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 border border-violet-200">系列</span>
              : item.skuCode && <span className="text-xs text-gray-400 font-mono">{item.skuCode}</span>
            }
            {item.brand && <span className="text-xs text-gray-400">{item.brand}</span>}
          </div>

          {/* Condition + price (view) */}
          {!editing && (
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <ItemStatusBadge status={item.status} />
              {/* Structured condition chip */}
              {item.conditionType && (
                <ConditionChip conditionType={item.conditionType} conditionParams={item.conditionParams} />
              )}
              {/* Legacy free-text condition */}
              {!item.conditionType && item.condition && (
                <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">{item.condition}</span>
              )}
              {item.price != null && (
                <span className="text-xs font-semibold text-brand-700">NT${item.price.toLocaleString()}</span>
              )}
              {item.adminNote && (
                <span className="text-xs text-gray-400 italic">備注：{item.adminNote}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <select
              value={item.status}
              onChange={(e) => handleStatusChange(e.target.value as ItemStatus)}
              className="text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400 text-gray-600"
            >
              <option value="待定價">待定價</option>
              <option value="已確認">已確認</option>
              <option value="不採用">不採用</option>
            </select>
          )}
          <button onClick={() => setEditing((e) => !e)}
            className="px-2 py-1 rounded text-xs border border-gray-200 text-gray-500 hover:border-brand-400 hover:text-brand-600 transition">
            {editing ? '收起' : '編輯'}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="px-2 py-1 rounded text-xs border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500 transition disabled:opacity-40">
            {deleting ? '…' : '移除'}
          </button>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="mt-3 space-y-4 border-t pt-3">
          {/* Structured condition editor */}
          <ConditionEditor
            conditionType={conditionType}
            conditionParams={conditionParams}
            onChange={handleConditionChange}
          />

          {/* Free-text condition label */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">
              促銷條件說明（自由文字，業務可見）
            </label>
            <input
              type="text"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="例：買5送1 / 2瓶12000 / 全系列7折"
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">促銷價格（參考，選填）</label>
              <input
                type="number" min={0} value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="優惠後單價"
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">行政備注</label>
              <input
                type="text" value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="定價說明…"
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg border text-xs text-gray-500 hover:bg-gray-50 transition">
              取消
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition">
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Promotion Detail Panel ────────────────────────────────────

function PromotionDetailPanel({ promo, onClose, onEdit }: {
  promo:   Promotion
  onClose: () => void
  onEdit:  () => void
}) {
  const [items,          setItems]          = useState<PromotionItem[]>([])
  const [loadingItems,   setLoadingItems]   = useState(true)
  const [showSearch,     setShowSearch]     = useState(false)
  const [addMode,        setAddMode]        = useState<'sku' | 'series'>('sku')
  const [addingItem,     setAddingItem]     = useState(false)
  const [confirmingAll,  setConfirmingAll]  = useState(false)
  const [statusFilter,   setStatusFilter]   = useState<ItemStatus | 'all'>('all')

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    setLoadingItems(true)
    fetch(`/api/promotions/${promo.id}/items`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoadingItems(false))
  }, [promo.id])

  const handleAddProduct = async (r: SearchResult) => {
    if (items.find((it) => it.skuCode === r.skuCode)) {
      alert(`「${r.name}」已在此活動中`)
      return
    }
    setAddingItem(true)
    try {
      const res = await fetch(`/api/promotions/${promo.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuCode: r.skuCode, skuName: r.name, brand: r.manufacturer }),
      })
      const item = await res.json()
      if (res.ok) setItems((prev) => [...prev, item])
    } catch {}
    finally { setAddingItem(false); setShowSearch(false) }
  }

  const handleAddSeries = async (s: SeriesResult) => {
    if (items.find((it) => it.seriesId === s.id)) {
      alert(`「${s.seriesName}」系列已在此活動中`)
      return
    }
    setAddingItem(true)
    try {
      const res = await fetch(`/api/promotions/${promo.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuCode:    '',
          skuName:    s.seriesName,
          brand:      s.brand,
          seriesId:   s.id,
          seriesName: s.seriesName,
        }),
      })
      const item = await res.json()
      if (res.ok) setItems((prev) => [...prev, item])
    } catch {}
    finally { setAddingItem(false); setShowSearch(false) }
  }

  const handleUpdateItem = (id: string, patch: Partial<PromotionItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const handleConfirmAll = async () => {
    const targets = items.filter((i) => i.status === '待定價')
    if (targets.length === 0) return
    setConfirmingAll(true)
    // 樂觀更新 UI
    setItems((prev) => prev.map((it) => it.status === '待定價' ? { ...it, status: '已確認' } : it))
    // 批次 PATCH（平行發送）
    await Promise.allSettled(
      targets.map((it) =>
        fetch(`/api/promotion-items/${it.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: '已確認' }),
        })
      )
    )
    setConfirmingAll(false)
  }

  const confirmed = items.filter((i) => i.status === '已確認').length
  const pending   = items.filter((i) => i.status === '待定價').length
  const dropped   = items.filter((i) => i.status === '不採用').length
  const displayedItems = statusFilter === 'all' ? items : items.filter((i) => i.status === statusFilter)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Card */}
      <motion.div
        className="relative w-full max-w-2xl mx-2 sm:mx-auto bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{    opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <StatusBadge status={promo.status} />
                {promo.type && <TypeBadge type={promo.type} />}
              </div>
              <h2 className="text-lg font-bold text-gray-900 leading-snug">{promo.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {fmtDate(promo.startDate)} – {fmtDate(promo.endDate)}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={onEdit}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 transition">
                編輯活動
              </button>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition text-lg">✕</button>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-4 mt-3">
            {promo.description && (
              <p className="text-xs text-gray-500 leading-relaxed flex-1">{promo.description}</p>
            )}
            {promo.dmUrl && (
              <a href={promo.dmUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline shrink-0">
                📄 查閱 DM
              </a>
            )}
          </div>

          {/* Stats + batch confirm */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
              <span className="text-green-600 font-semibold">✅ 已確認 {confirmed}</span>
              <span className="text-yellow-600 font-semibold">⏳ 待定價 {pending}</span>
              {dropped > 0 && <span className="text-red-500">❌ 不採用 {dropped}</span>}
              <span className="text-gray-400">共 {items.length} 項</span>
              {pending > 0 && (
                <button
                  onClick={handleConfirmAll}
                  disabled={confirmingAll}
                  className="ml-auto px-2.5 py-1 rounded-lg bg-green-500 text-white font-semibold text-[11px] hover:bg-green-600 disabled:opacity-50 transition"
                >
                  {confirmingAll ? '確認中…' : `⚡ 全部確認 (${pending})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Items — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Add item toolbar */}
          <div className="px-4 sm:px-5 py-3 border-b bg-gray-50/80 sticky top-0 z-10">
            <div className="flex items-center justify-between mb-2">
              {/* Status filter tabs */}
              <div className="flex gap-1 flex-wrap">
                {([['all', '全部'], ['待定價', '待定價'], ['已確認', '已確認'], ['不採用', '不採用']] as [string, string][]).map(([val, label]) => {
                  const count = val === 'all' ? items.length
                    : items.filter((i) => i.status === val).length
                  return (
                    <button key={val} type="button"
                      onClick={() => setStatusFilter(val as ItemStatus | 'all')}
                      className={[
                        'px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition',
                        statusFilter === val
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'border-gray-200 text-gray-500 hover:border-brand-300 hover:text-brand-600 bg-white',
                      ].join(' ')}>
                      {label} {count > 0 && <span className="opacity-70">({count})</span>}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setShowSearch((s) => !s)}
                disabled={addingItem}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition"
              >
                {addingItem ? '新增中…' : showSearch ? '收起' : '+ 新增品項'}
              </button>
            </div>
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1 space-y-2">
                    <div className="flex gap-1">
                      {(['sku', 'series'] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setAddMode(m)}
                          className={[
                            'px-3 py-1 rounded-full text-xs font-medium border transition',
                            addMode === m
                              ? 'bg-brand-500 border-brand-500 text-white'
                              : 'border-gray-300 text-gray-500 hover:border-brand-400 hover:text-brand-600',
                          ].join(' ')}>
                          {m === 'sku' ? '單一商品' : '商品系列'}
                        </button>
                      ))}
                    </div>
                    {addMode === 'sku'
                      ? <ProductSearchPicker onSelect={handleAddProduct} />
                      : <SeriesPicker onSelect={handleAddSeries} />
                    }
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Items list */}
          {loadingItems && (
            <div className="divide-y">
              {[1,2,3].map((i) => (
                <div key={i} className="h-14 px-5 py-3 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              ))}
            </div>
          )}
          {!loadingItems && items.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">📋</div>
              <p className="text-sm">尚未加入任何品項</p>
              <button onClick={() => setShowSearch(true)}
                className="mt-2 text-xs text-brand-600 hover:underline font-medium">
                點擊「新增品項」開始選品
              </button>
            </div>
          )}
          {!loadingItems && items.length > 0 && displayedItems.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">此篩選條件下無品項</p>
              <button onClick={() => setStatusFilter('all')}
                className="mt-1 text-xs text-brand-600 hover:underline">顯示全部</button>
            </div>
          )}
          {!loadingItems && displayedItems.length > 0 && (
            <div className="divide-y">
              {displayedItems.map((item) => (
                <ItemRow key={item.id} item={item} onUpdate={handleUpdateItem} onDelete={handleDeleteItem} />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Promotion Edit Drawer ─────────────────────────────────────

interface DrawerProps {
  initial?: Promotion | null
  /** 若帶入此值，表示「複製模式」：drawer 預填欄位但儲存後另建新活動 */
  copyOf?:  Promotion | null
  onClose:  () => void
  onSaved:  (p: Promotion, copySourceId?: string) => void
}

function PromotionDrawer({ initial, copyOf, onClose, onSaved }: DrawerProps) {
  const isCopy = !!copyOf
  const isEdit = !!initial && !isCopy
  const src    = copyOf ?? initial    // 用來預填的資料來源

  const [name,        setName]        = useState(isCopy ? `複製－${src?.name ?? ''}` : (src?.name        ?? ''))
  const [type,        setType]        = useState<PromotionType | ''>(src?.type ?? '')
  // 複製模式：日期清空，讓行政重新填
  const [startDate,   setStartDate]   = useState(isCopy ? '' : (src?.startDate   ?? ''))
  const [endDate,     setEndDate]     = useState(isCopy ? '' : (src?.endDate     ?? ''))
  const [description, setDescription] = useState(src?.description ?? '')
  const [dmUrl,       setDmUrl]       = useState(isCopy ? '' : (src?.dmUrl ?? ''))
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const handleSave = async () => {
    if (!name.trim()) { setError('請填寫活動名稱'); return }
    setError(''); setSaving(true)
    try {
      const body = { name: name.trim(), type: type || undefined, startDate: startDate || undefined, endDate: endDate || undefined, description, dmUrl: dmUrl || undefined }
      const res = isEdit
        ? await fetch(`/api/promotions/${initial!.id}`, { method: 'PUT',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/promotions',                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '儲存失敗')
      // 複製模式：把來源 ID 回傳給 parent，讓它詢問是否複製品項
      onSaved(data, isCopy ? (copyOf?.id ?? undefined) : undefined)
    } catch (err: any) {
      setError(err.message ?? '儲存失敗，請重試')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg mx-2 sm:mx-auto bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{    opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      >
        <div className="px-4 sm:px-6 py-5 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            {isCopy ? '複製促銷活動' : isEdit ? '編輯促銷活動' : '新增促銷活動'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動名稱 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="例：2026 年 Q2 季度展場"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動類型</label>
            <div className="flex flex-wrap gap-2">
              {(['', ...PROMOTION_TYPES] as (PromotionType | '')[]).map((t) => (
                <button key={t || 'none'} type="button" onClick={() => setType(t)}
                  className={['px-3 py-1.5 rounded-full text-xs font-medium border transition',
                    type === t ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
                  ].join(' ')}>
                  {t || '不指定'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">開始日期</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">結束日期</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動說明</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="活動內容、優惠條件說明…" rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">DM 附件連結</label>
            <input type="url" value={dmUrl} onChange={(e) => setDmUrl(e.target.value)}
              placeholder="https://…（Notion 附件、Google Drive 等）"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <p className="text-[11px] text-gray-400 mt-1">貼入公開連結，業務可直接點開查閱</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t shrink-0 rounded-b-2xl bg-gray-50/60">
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition">
              {saving ? '儲存中…' : isCopy ? '建立複製版' : isEdit ? '儲存變更' : '建立活動'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Promotion Card ────────────────────────────────────────────

function PromotionCard({ promo, onView, onEdit, onCopy, onDelete }: {
  promo:    Promotion
  onView:   () => void
  onEdit:   () => void
  onCopy:   () => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`確定要刪除「${promo.name}」嗎？`)) return
    setDeleting(true)
    await fetch(`/api/promotions/${promo.id}`, { method: 'DELETE' }).catch(() => {})
    onDelete()
  }

  return (
    <div onClick={onView}
      className="panel p-4 hover:shadow-md transition-shadow cursor-pointer hover:border-brand-200 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <StatusBadge status={promo.status} />
            {promo.type && <TypeBadge type={promo.type} />}
          </div>
          <h3 className="font-semibold text-gray-900 text-sm group-hover:text-brand-700 transition-colors">{promo.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(promo.startDate)} – {fmtDate(promo.endDate)}</p>
          {promo.description && (
            <p className="text-xs text-gray-500 mt-1.5 line-clamp-1">{promo.description}</p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition">
            編輯
          </button>
          <button onClick={(e) => { e.stopPropagation(); onCopy() }}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50 transition"
            title="複製此活動（建立新活動並預填欄位）">
            複製
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-40">
            {deleting ? '…' : '刪除'}
          </button>
        </div>
        <div className="text-gray-300 group-hover:text-brand-400 transition-colors text-sm shrink-0 mt-0.5">›</div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

const STATUS_ORDER: PromotionStatus[] = ['進行中', '規劃中', '已結束']
const STATUS_LABEL: Record<PromotionStatus, string> = {
  '進行中': '🟢 進行中',
  '規劃中': '🔵 即將開始',
  '已結束': '⚪ 已結束',
}

export function PromotionsContent() {
  const [promos,  setPromos]  = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState<Promotion | null>(null)
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null)
  // 複製模式：copyOf 是來源活動，drawer 以複製模式開啟
  const [copyOf,  setCopyOf]  = useState<Promotion | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/promotions').then((r) => r.json())
      if (Array.isArray(data)) setPromos(data)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaved = async (p: Promotion, copySourceId?: string) => {
    setPromos((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next }
      return [p, ...prev]
    })
    if (viewing && viewing.id === p.id) setViewing(p)
    setEditing(null)
    setCopyOf(null)

    // 複製模式：詢問是否同步複製品項
    if (copySourceId) {
      const doCopy = confirm(`活動「${p.name}」已建立。\n\n是否將原活動的促銷品項一併複製過來？`)
      if (doCopy) {
        try {
          // 取得來源品項
          const srcItems: PromotionItem[] = await fetch(`/api/promotions/${copySourceId}/items`)
            .then((r) => r.json())
          // 批次 POST 到新活動（並行）
          await Promise.allSettled(
            srcItems.map((it) =>
              fetch(`/api/promotions/${p.id}/items`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  skuCode:         it.skuCode,
                  skuName:         it.skuName,
                  brand:           it.brand,
                  seriesId:        it.seriesId,
                  seriesName:      it.seriesName,
                  condition:       it.condition,
                  conditionType:   it.conditionType,
                  conditionParams: it.conditionParams,
                  price:           it.price,
                  adminNote:       it.adminNote,
                  // status 重置為待定價，讓行政重新確認
                }),
              })
            )
          )
          alert(`已複製 ${srcItems.length} 個品項，請進入活動確認定價。`)
        } catch {
          alert('品項複製時發生錯誤，請手動新增。')
        }
      }
    }
  }

  const handleDelete = (id: string) => {
    setPromos((prev) => prev.filter((p) => p.id !== id))
    if (viewing?.id === id) setViewing(null)
  }

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = promos.filter((p) => p.status === s)
    return acc
  }, {} as Record<PromotionStatus, Promotion[]>)

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          共 {promos.length} 個活動
          {promos.filter((p) => p.status === '進行中').length > 0 && (
            <span className="ml-2 text-green-600 font-medium">
              · {promos.filter((p) => p.status === '進行中').length} 個進行中
            </span>
          )}
        </p>
        <button onClick={() => setEditing('new')} className="button-primary px-4 py-2 text-sm">
          + 新增活動
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && promos.length === 0 && (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-3">🎪</div>
          <p className="text-sm">尚未建立任何促銷活動</p>
          <button onClick={() => setEditing('new')} className="mt-3 text-xs text-brand-600 hover:underline font-medium">立即新增</button>
        </div>
      )}

      {!loading && promos.length > 0 && (
        <div className="space-y-8">
          {STATUS_ORDER.map((status) => {
            const list = grouped[status]
            if (list.length === 0) return null
            return (
              <div key={status}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                  {STATUS_LABEL[status]} <span className="font-normal">({list.length})</span>
                </h3>
                <div className="space-y-3">
                  {list.map((promo) => (
                    <PromotionCard
                      key={promo.id}
                      promo={promo}
                      onView={() => setViewing(promo)}
                      onEdit={() => { setViewing(null); setEditing(promo) }}
                      onCopy={() => { setViewing(null); setEditing(null); setCopyOf(promo) }}
                      onDelete={() => handleDelete(promo.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {viewing && (
          <PromotionDetailPanel
            promo={viewing}
            onClose={() => setViewing(null)}
            onEdit={() => { setEditing(viewing); setViewing(null) }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing !== null && (
          <PromotionDrawer
            initial={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {copyOf !== null && (
          <PromotionDrawer
            copyOf={copyOf}
            onClose={() => setCopyOf(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>
    </>
  )
}
