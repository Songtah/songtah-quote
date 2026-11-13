'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { adjustPrice, ROUNDING_OPTIONS, type Rounding } from '@/lib/price-rounding'
import { PRODUCT_LABELS } from '@/lib/product-labels'

interface Item {
  code: string
  name: string
  officialName?: string
  brand: string
  category: string
  mainCategory?: string
  price?: number
  basePrice?: number | null
  priceSource?: 'override' | 'catalog' | 'unset'
  discontinued?: boolean
  disabled?: boolean
  imageUrl?: string
}

type Change = { code: string; name: string; brand: string; before: number | null; after: number | null; at: number; actor: string; source: string; note?: string }
type Counts = { newPrice: number; increase: number; decrease: number; cleared: number }
type Announcement = { period: string; createdAt: number; counts: Counts; rows: Change[] }

type Scope = 'unpriced' | 'all' | 'manual'
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'unpriced', label: PRODUCT_LABELS.unpriced },
  { key: 'all', label: '全部在售' },
  { key: 'manual', label: PRODUCT_LABELS.manualPrice },
]
const PAGE = 100
const CHUNK = 25
const money = (value: number | null | undefined) => (value == null ? '—' : `NT$${value.toLocaleString('zh-TW')}`)
const periodLabel = (period: string) => `${period.slice(0, 4)} 年 ${Number(period.slice(5))} 月`

function countsText(c: Counts) {
  return [c.newPrice && `新定價 ${c.newPrice}`, c.increase && `調漲 ${c.increase}`, c.decrease && `調降 ${c.decrease}`, c.cleared && `取消定價 ${c.cleared}`]
    .filter(Boolean).join(' · ') || '沒有異動'
}

export function PricingContent({ canManage, initialTab, initialPeriod }: { canManage: boolean; initialTab: 'workspace' | 'announcements'; initialPeriod?: string }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/products/catalog" className="flex min-h-10 items-center gap-1 rounded-full border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95">
          <span aria-hidden="true">←</span>產品
        </Link>
        {canManage && (
          <div className="flex rounded-full bg-stone-100 p-1" role="tablist" aria-label="定價頁籤">
            {([['workspace', '調價工作區'], ['announcements', '價格公告']] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all active:scale-95 ${tab === key ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === 'workspace' && canManage ? <Workspace /> : <Announcements canManage={canManage} initialPeriod={initialPeriod} />}
    </div>
  )
}

// ── 調價工作區 ────────────────────────────────────────────────

function Workspace() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)

  const [scope, setScope] = useState<Scope>('unpriced')
  const [brand, setBrand] = useState('')
  const [main, setMain] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 待儲存的新價格：貨號 → 價格＋來源（手填＝workspace；百分比＝batch）
  const [draft, setDraft] = useState<Map<string, { price: number; source: 'workspace' | 'batch' }>>(new Map())
  const [percent, setPercent] = useState('5')
  const [rounding, setRounding] = useState<Rounding>('round10')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<{ ok: number; failed: { code: string; error: string }[] } | null>(null)

  useEffect(() => {
    setLoading(true)
    setLoadError('')
    fetch('/api/products/catalog-raw', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`產品資料讀取失敗（HTTP ${response.status}）`)
        return response.json()
      })
      .then((data: Item[]) => setItems(Array.isArray(data) ? data.filter((item) => !item.discontinued) : []))
      .catch((error) => setLoadError(error instanceof Error ? error.message : '產品資料暫時無法讀取'))
      .finally(() => setLoading(false))
  }, [attempt])

  const options = useMemo(() => {
    const uniq = (values: (string | undefined)[]) => Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    return {
      brands: uniq(items.map((item) => item.brand)),
      mains: uniq(items.filter((item) => !brand || item.brand === brand).map((item) => item.mainCategory)),
      categories: uniq(items.filter((item) => (!brand || item.brand === brand) && (!main || item.mainCategory === main)).map((item) => item.category)),
    }
  }, [items, brand, main])

  const scopeCounts = useMemo(() => ({
    unpriced: items.filter((item) => item.price == null).length,
    all: items.length,
    manual: items.filter((item) => item.priceSource === 'override').length,
  }), [items])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) =>
      (scope === 'all' || (scope === 'unpriced' ? item.price == null : item.priceSource === 'override')) &&
      (!brand || item.brand === brand) &&
      (!main || item.mainCategory === main) &&
      (!category || item.category === category) &&
      (!q || item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || (item.officialName ?? '').toLowerCase().includes(q)))
  }, [items, scope, brand, main, category, query])

  useEffect(() => { setVisible(PAGE) }, [scope, brand, main, category, query])

  const allRowsSelected = rows.length > 0 && rows.every((row) => selected.has(row.code))
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev)
    if (allRowsSelected) rows.forEach((row) => next.delete(row.code)); else rows.forEach((row) => next.add(row.code))
    return next
  })
  const toggle = (code: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })

  const percentValue = Number(percent)
  const percentValid = percent.trim() !== '' && Number.isFinite(percentValue) && percentValue > -90 && percentValue <= 300 && percentValue !== 0
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.code)), [items, selected])
  const selectedWithPrice = selectedItems.filter((item) => item.price != null)

  const applyPercent = () => {
    if (!percentValid) return
    setDraft((prev) => {
      const next = new Map(prev)
      for (const item of selectedWithPrice) next.set(item.code, { price: adjustPrice(item.price!, percentValue, rounding), source: 'batch' })
      return next
    })
    setResult(null)
  }

  const setManual = (code: string, raw: string) => {
    setDraft((prev) => {
      const next = new Map(prev)
      const value = Number(raw)
      if (raw.trim() === '' || !Number.isInteger(value) || value <= 0) next.delete(code)
      else next.set(code, { price: value, source: 'workspace' })
      return next
    })
    setResult(null)
  }

  const itemByCode = useMemo(() => new Map(items.map((item) => [item.code, item])), [items])
  const pending = useMemo(() => Array.from(draft.entries())
    .map(([code, value]) => ({ code, ...value, item: itemByCode.get(code) }))
    .filter((entry) => entry.item && entry.item.price !== entry.price), [draft, itemByCode])
  const summary = useMemo(() => {
    const c = { newPrice: 0, increase: 0, decrease: 0, cleared: 0 }
    for (const entry of pending) {
      const before = entry.item!.price
      if (before == null) c.newPrice += 1; else if (entry.price > before) c.increase += 1; else c.decrease += 1
    }
    return c
  }, [pending])

  const save = async () => {
    if (pending.length === 0) return
    setSaving(true)
    setResult(null)
    let ok = 0
    const failed: { code: string; error: string }[] = []
    const updates = new Map<string, number>()
    for (const source of ['workspace', 'batch'] as const) {
      const list = pending.filter((entry) => entry.source === source)
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK)
        setProgress(`儲存中 ${ok + failed.length + chunk.length} / ${pending.length}`)
        try {
          const response = await fetch('/api/products/prices/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: chunk.map((entry) => ({ code: entry.code, price: entry.price })), source, note: note.trim() || undefined }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
          for (const row of data.updated ?? []) { ok += 1; updates.set(row.code, row.after) }
          failed.push(...(data.failed ?? []))
        } catch (error) {
          for (const entry of chunk) failed.push({ code: entry.code, error: error instanceof Error ? error.message : '儲存失敗' })
        }
      }
    }
    setItems((prev) => prev.map((item) => (updates.has(item.code) ? { ...item, price: updates.get(item.code)!, priceSource: 'override' } : item)))
    setDraft((prev) => {
      const next = new Map(prev)
      updates.forEach((_, code) => next.delete(code))
      return next
    })
    setSelected(new Set())
    setResult({ ok, failed })
    setProgress('')
    setSaving(false)
  }

  if (loading) return <div className="h-96 animate-pulse rounded-3xl bg-stone-100 motion-reduce:animate-none" />
  if (loadError) {
    return (
      <div className="card-soft flex flex-col items-center px-5 py-10 text-center" role="alert">
        <h3 className="text-base font-bold text-stone-800">產品資料載入失敗</h3>
        <p className="mt-1 text-sm text-stone-500">{loadError}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className="button-secondary mt-5 min-h-11 px-5">重新載入</button>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      {/* 篩選 */}
      <div className="card-soft space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.map((option) => (
            <button key={option.key} type="button" onClick={() => setScope(option.key)} aria-pressed={scope === option.key}
              className={`chip ${scope === option.key ? 'chip-active' : ''}`}>
              {option.label} <span className="tabular-nums opacity-60">{scopeCounts[option.key].toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <input type="search" aria-label="搜尋" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋貨號或品名…" className="input-soft col-span-2 w-full lg:col-span-1" />
          <select aria-label="品牌" value={brand} onChange={(event) => { setBrand(event.target.value); setMain(''); setCategory('') }} className="select-soft w-full">
            <option value="">全部品牌</option>
            {options.brands.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="主分類" value={main} onChange={(event) => { setMain(event.target.value); setCategory('') }} className="select-soft w-full">
            <option value="">全部主分類</option>
            {options.mains.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select aria-label="細分類" value={category} onChange={(event) => setCategory(event.target.value)} className="select-soft w-full">
            <option value="">全部細分類</option>
            {options.categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>

      {/* 批次漲幅 */}
      <div className="card-soft p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-bold text-stone-700">批次漲幅</h3>
          <span className="text-xs text-stone-400">勾選品項後設定百分比，先算出新價格放進待儲存清單，確認後再儲存。待定價品項沒有原價，不會被調整。</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">調整幅度</span>
            <span className="relative mt-1 block">
              <input type="number" inputMode="decimal" step="0.5" value={percent} onChange={(event) => setPercent(event.target.value)}
                className="input-soft w-32 pr-9 text-right font-semibold tabular-nums" aria-describedby="percent-hint" />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-stone-400">%</span>
            </span>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">取整方式</span>
            <select value={rounding} onChange={(event) => setRounding(event.target.value as Rounding)} className="select-soft mt-1 block w-48">
              {ROUNDING_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={applyPercent} disabled={!percentValid || selectedWithPrice.length === 0}
            className="min-h-11 rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
            套用到已勾選的 {selectedWithPrice.length.toLocaleString()} 筆
          </button>
        </div>
        <p id="percent-hint" className="mt-2 text-xs text-stone-400">
          {percentValid
            ? <>例：NT$1,000 → <b className="text-stone-600">{money(adjustPrice(1000, percentValue, rounding))}</b>、NT$2,350 → <b className="text-stone-600">{money(adjustPrice(2350, percentValue, rounding))}</b>（負數為調降）</>
            : '請輸入 -90～300 之間、不為 0 的百分比'}
          {selectedItems.length > selectedWithPrice.length && <span className="ml-2 text-amber-600">已勾選中有 {selectedItems.length - selectedWithPrice.length} 筆待定價，會略過</span>}
        </p>
      </div>

      {/* 品項表 */}
      <div className="card-soft overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-stone-900/[0.06] px-4 py-3">
          <input type="checkbox" checked={allRowsSelected} onChange={toggleAll} aria-label="全選目前清單" className="h-4 w-4 accent-brand-500" />
          <span className="text-sm font-bold text-stone-700">{rows.length.toLocaleString()} 個品項</span>
          {selected.size > 0 && <span className="text-xs text-brand-700">已勾選 {selected.size.toLocaleString()}</span>}
          {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-stone-500 transition-all hover:bg-stone-100 active:scale-95">取消勾選</button>}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-stone-400">{scope === 'unpriced' ? '這個範圍沒有待定價的品項 🎉' : '找不到符合的品項'}</p>
        ) : (
          <div className="divide-y divide-stone-900/[0.05]">
            {rows.slice(0, visible).map((item) => {
              const pendingPrice = draft.get(item.code)
              const changed = pendingPrice && pendingPrice.price !== item.price
              const diff = changed && item.price != null ? Math.round(((pendingPrice!.price - item.price) / item.price) * 1000) / 10 : null
              return (
                <div key={item.code} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors sm:flex-nowrap ${selected.has(item.code) ? 'bg-brand-50/50' : 'hover:bg-brand-50/30'}`}>
                  <input type="checkbox" checked={selected.has(item.code)} onChange={() => toggle(item.code)} aria-label={`勾選 ${item.code}`} className="h-4 w-4 shrink-0 accent-brand-500" />
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-stone-900/[0.05]">
                    {item.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                      : <span className="text-stone-300" aria-hidden="true">◇</span>}
                  </span>
                  <Link href={`/products/item/${encodeURIComponent(item.code)}`} className="min-w-0 flex-1 basis-48 rounded-xl transition-colors hover:text-brand-700">
                    <span className="block truncate text-sm font-medium text-stone-700">{item.officialName || item.name}</span>
                    <span className="block truncate text-[11px] text-stone-400"><span className="font-mono">{item.code}</span> · {item.brand}</span>
                  </Link>
                  <span className="w-28 shrink-0 text-right">
                    {item.price != null
                      ? <span className="text-sm font-semibold tabular-nums text-stone-700">{money(item.price)}</span>
                      : <span className="text-xs font-semibold text-amber-600">{PRODUCT_LABELS.unpriced}</span>}
                    {item.priceSource === 'override' && <span className="block text-[10px] font-semibold text-brand-600">{PRODUCT_LABELS.manualPrice}</span>}
                  </span>
                  <span className="text-stone-300" aria-hidden="true">→</span>
                  <span className="relative w-32 shrink-0">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-stone-400">NT$</span>
                    <input type="number" inputMode="numeric" min="1" step="1" aria-label={`${item.code} 新售價`}
                      value={pendingPrice?.price ?? ''} onChange={(event) => setManual(item.code, event.target.value)}
                      placeholder={item.price != null ? String(item.price) : '新售價'}
                      className={`input-soft w-full pl-10 text-right text-sm font-semibold tabular-nums ${changed ? 'ring-2 ring-brand-300' : ''}`} />
                  </span>
                  <span className={`w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums ${diff == null ? 'text-stone-300' : diff > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {changed ? (diff == null ? '新定價' : `${diff > 0 ? '+' : ''}${diff}%`) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {visible < rows.length && (
          <div className="border-t border-stone-900/[0.06] py-3 text-center">
            <button type="button" onClick={() => setVisible((count) => count + PAGE)} className="min-h-11 rounded-full bg-brand-50 px-5 text-xs font-semibold text-brand-700 transition-all hover:bg-brand-100 active:scale-95">
              再顯示 {Math.min(PAGE, rows.length - visible)} 筆（還有 {(rows.length - visible).toLocaleString()} 筆）
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className={`rounded-2xl px-4 py-3 text-sm ${result.failed.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`} role="status">
          已儲存 {result.ok} 筆，會列入下個月 1 日的價格公告。
          {result.failed.length > 0 && <> {result.failed.length} 筆失敗：{result.failed.slice(0, 5).map((f) => `${f.code}（${f.error}）`).join('、')}{result.failed.length > 5 ? '…' : ''}</>}
        </div>
      )}

      {/* 待儲存列 */}
      {pending.length > 0 && (
        <div className="glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-stone-900/[0.06] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-stone-800">{pending.length.toLocaleString()} 筆待儲存</p>
              <p className="text-xs text-stone-500">{countsText(summary)}</p>
            </div>
            <input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="調價原因（選填，會寫進公告）" aria-label="調價原因" className="input-soft w-full sm:w-64" />
            <button type="button" onClick={() => setDraft(new Map())} disabled={saving} className="button-secondary min-h-11 px-4">清除</button>
            <button type="button" onClick={save} disabled={saving}
              className="min-h-11 rounded-full bg-brand-500 px-6 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-60">
              {saving ? progress || '儲存中…' : '儲存新售價'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 價格公告 ──────────────────────────────────────────────────

function Announcements({ canManage, initialPeriod }: { canManage: boolean; initialPeriod?: string }) {
  const [data, setData] = useState<{ announcements: Announcement[]; pending: { period: string; counts: Counts; rows: Change[] } | null } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string>(initialPeriod ?? '')

  useEffect(() => {
    fetch('/api/products/prices/announcements', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
        return body
      })
      .then((body) => {
        setData(body)
        if (!initialPeriod && body?.announcements?.[0]) setOpen(body.announcements[0].period)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '價格公告暫時無法讀取'))
  }, [initialPeriod])

  if (error) return <div className="card-soft px-5 py-10 text-center text-sm text-red-600" role="alert">{error}</div>
  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-stone-100 motion-reduce:animate-none" />

  return (
    <div className="space-y-4">
      {canManage && data.pending && (
        <section className="card-soft overflow-hidden p-0">
          <div className="border-b border-stone-900/[0.06] bg-brand-50/50 px-4 py-3 sm:px-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">下次公告預覽（只有中央管理看得到）</p>
            <h3 className="mt-1 text-sm font-bold text-stone-800">{periodLabel(data.pending.period)}到目前為止：{data.pending.rows.length} 個品項</h3>
            <p className="mt-0.5 text-xs text-stone-500">{countsText(data.pending.counts)} · 下個月 1 日自動發布並通知全公司</p>
          </div>
          {data.pending.rows.length > 0 && <ChangeTable rows={data.pending.rows} />}
        </section>
      )}

      {data.announcements.length === 0 ? (
        <div className="card-soft px-5 py-12 text-center">
          <p className="text-sm font-semibold text-stone-700">還沒有價格公告</p>
          <p className="mt-1 text-xs text-stone-400">每月 1 日會彙整上個月的新定價與調價；沒有異動的月份不發公告。</p>
        </div>
      ) : data.announcements.map((announcement) => {
        const expanded = open === announcement.period
        return (
          <section key={announcement.period} className="card-soft overflow-hidden p-0">
            <button type="button" onClick={() => setOpen(expanded ? '' : announcement.period)} aria-expanded={expanded}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-all hover:bg-brand-50/40 active:scale-[0.99] sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-stone-800">{periodLabel(announcement.period)}價格異動公告</span>
                <span className="mt-0.5 block text-xs text-stone-500">{announcement.rows.length} 個品項 · {countsText(announcement.counts)}</span>
              </span>
              <span className="text-xs font-semibold text-brand-600">{expanded ? '收合' : '查看'}</span>
            </button>
            {expanded && <ChangeTable rows={announcement.rows} />}
          </section>
        )
      })}
    </div>
  )
}

function ChangeTable({ rows }: { rows: Change[] }) {
  const notes = Array.from(new Set(rows.map((row) => row.note).filter(Boolean)))
  return (
    <div className="border-t border-stone-900/[0.06]">
      {notes.length > 0 && <p className="px-4 pt-3 text-xs text-stone-500 sm:px-5">調價原因：{notes.join('；')}</p>}
      <div className="max-h-[60vh] overflow-auto px-2 py-2 sm:px-3">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-stone-400">
              <th className="px-2 py-2">品項</th><th className="px-2 py-2">品牌</th>
              <th className="px-2 py-2 text-right">原售價</th><th className="px-2 py-2 text-right">新售價</th><th className="px-2 py-2 text-right">變動</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pct = row.before != null && row.after != null ? Math.round(((row.after - row.before) / row.before) * 1000) / 10 : null
              return (
                <tr key={row.code} className="border-t border-stone-900/[0.05]">
                  <td className="px-2 py-2">
                    <Link href={`/products/item/${encodeURIComponent(row.code)}`} className="font-medium text-stone-700 transition-colors hover:text-brand-700">{row.name}</Link>
                    <span className="block font-mono text-[11px] text-stone-400">{row.code}</span>
                  </td>
                  <td className="px-2 py-2 text-stone-500">{row.brand}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-stone-400">{row.before == null ? PRODUCT_LABELS.unpriced : money(row.before)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-stone-800">{row.after == null ? '取消定價' : money(row.after)}</td>
                  <td className={`px-2 py-2 text-right text-xs font-semibold tabular-nums ${pct == null ? 'text-brand-600' : pct > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {row.before == null ? '新定價' : row.after == null ? '—' : `${pct! > 0 ? '+' : ''}${pct}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
