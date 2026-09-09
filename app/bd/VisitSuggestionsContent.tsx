'use client'

/**
 * 拜訪建議 —— 出門前的彈藥清單。
 *
 * 2026-09-09 改版：舊版必須先選縣市＋行政區才會出東西，而且分 A/B/C 三組，
 * 其中 B 例行拜訪實測五個業務全部 0。新版改為：
 *   預設「今天該跑誰」——不必選任何東西，開頁就是排好序的名單；
 *   需要規劃路線時再切「指定區域」。
 * 每筆都列出完整理由（可能同時命中多個訊號），排序依評分。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Flame, MapPin, Phone, Sparkles, Clock3, Copy, Check } from 'lucide-react'

type Kind = 'overdue' | 'hot' | 'stale' | 'newOpening'
type Suggestion = {
  id: string; name: string; type: string; city: string; district: string
  address: string; phone: string; salesperson: string
  kind: Kind; reasons: string[]; score: number; lastVisit: string | null; isMine: boolean
}
type Result = {
  mode: 'today' | 'area'
  items: Suggestion[]
  total: number
  byKind: Record<Kind, number>
  scope: string
  builtAt: string
  existingOnly?: boolean
  salespeople?: string[]
  needsSalesperson?: boolean
}
type RegionRow = { city: string; district: string; salesperson: string; count: number }
type Adoption = { totalCopies: number; totalSuggested: number; totalVisited: number; rate: number }

const KIND_META: Record<Kind, { label: string; icon: typeof Flame; cls: string }> = {
  overdue:    { label: '追蹤逾期', icon: CalendarClock, cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  hot:        { label: '客戶正熱', icon: Flame,         cls: 'bg-brand-50 text-brand-700 ring-brand-200' },
  newOpening: { label: '新開業',   icon: Sparkles,      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  stale:      { label: '太久沒跑', icon: Clock3,        cls: 'bg-stone-100 text-stone-600 ring-stone-200' },
}
const KIND_ORDER: Kind[] = ['overdue', 'hot', 'newOpening', 'stale']

const telHref = (p: string) => 'tel:' + p.replace(/[^\d+]/g, '')
const mapHref = (name: string, addr: string) =>
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr || name)

export default function VisitSuggestionsContent({ currentUser }: { currentUser?: string }) {
  const [mode, setMode] = useState<'today' | 'area'>('today')
  const [who, setWho] = useState('')          // 主管檢視用：要看哪位業務的名單
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [rows, setRows] = useState<RegionRow[]>([])
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kindFilter, setKindFilter] = useState<Kind | ''>('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [adoption, setAdoption] = useState<Adoption | null>(null)

  useEffect(() => {
    fetch('/api/bd/visit-suggestions/adoption?mine=1&days=30')
      .then((r) => r.json()).then((d) => { if (!d.error) setAdoption(d) }).catch(() => {})
  }, [])

  // 區域選項只在切到「指定區域」時才需要
  useEffect(() => {
    if (mode !== 'area' || rows.length) return
    fetch('/api/customers/region-stats').then((r) => r.json())
      .then((d) => setRows(d.rows ?? [])).catch(() => {})
  }, [mode, rows.length])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setChecked(new Set())
    try {
      const qs = new URLSearchParams({ mode, limit: '30' })
      if (who) qs.set('salesperson', who)
      if (mode === 'area') { qs.set('city', city); qs.set('district', district) }
      const res = await fetch('/api/bd/visit-suggestions?' + qs.toString())
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '讀取失敗')
      setData(json)
    } catch (e: any) {
      setError(e?.message ?? '產生拜訪建議失敗'); setData(null)
    } finally { setLoading(false) }
  }, [mode, city, district, who])

  // today 模式開頁直接載入；area 模式要選完才載
  useEffect(() => {
    if (mode === 'today') load()
    else if (city && district) load()
    else { setData(null); setLoading(false) }
  }, [mode, city, district, who, load])

  const cities = useMemo(() => Array.from(new Set(rows.map((r) => r.city).filter(Boolean))).sort(), [rows])
  const districts = useMemo(
    () => Array.from(new Set(rows.filter((r) => r.city === city).map((r) => r.district).filter(Boolean))).sort(),
    [rows, city])

  const items = useMemo(
    () => (data?.items ?? []).filter((i) => !kindFilter || i.kind === kindFilter),
    [data, kindFilter])

  const toggle = (id: string) =>
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const copyList = async () => {
    const picked = items.filter((i) => checked.has(i.id))
    const list = picked.length ? picked : items
    const text = list.map((i, n) =>
      `${n + 1}. ${i.name}（${i.city}${i.district}）${i.phone ? ' ' + i.phone : ''}\n   ${i.reasons.join('；')}`
    ).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
      fetch('/api/bd/visit-suggestions/adoption', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: data?.scope ?? '', items: list.map((i) => ({ id: i.id, kind: i.kind })) }),
      }).catch(() => {})
    } catch { setError('無法複製到剪貼簿') }
  }

  return (
    <div className="space-y-4">
      {/* 模式切換 */}
      <div className="card-soft p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {([['today', '今天該跑誰'], ['area', '指定區域']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
                mode === m ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'
              }`}>{label}</button>
          ))}
          {(data?.salespeople?.length ?? 0) > 0 && (
            <select value={who} onChange={(e) => setWho(e.target.value)} className="select-soft text-sm"
              aria-label="查看哪位業務的名單">
              <option value="">{data?.needsSalesperson ? '請選擇業務' : '我自己'}</option>
              {data!.salespeople!.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {mode === 'area' && (
            <>
              <select value={city} onChange={(e) => { setCity(e.target.value); setDistrict('') }} className="select-soft text-sm">
                <option value="">選縣市</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!city} className="select-soft text-sm">
                <option value="">選行政區</option>
                {districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </>
          )}
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          {mode === 'today'
            ? '不用選任何東西。系統依「追蹤逾期 → 客戶正熱 → 新開業 → 太久沒跑」排序，每筆都寫明為什麼推。'
            : '出差或跑固定路線時用。會列出該區所有值得跑的客戶，含尚未認領的。'}
          {data?.scope && <span className="ml-1 text-stone-500">範圍：{data.scope}。</span>}
        </p>
        {adoption && adoption.totalSuggested > 0 && (
          <p className="mt-1.5 text-xs text-stone-400">
            近 30 天你複製了 {adoption.totalCopies} 次名單，建議的 {adoption.totalSuggested} 家中有 {adoption.totalVisited} 家事後真的跑了（採納率 {(adoption.rate * 100).toFixed(0)}%）。
          </p>
        )}
      </div>

      {/* 分類統計＋篩選 */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setKindFilter('')}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition-all active:scale-95 ${
              kindFilter === '' ? 'bg-stone-800 text-white ring-stone-800' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'}`}>
            全部 {data.total}
          </button>
          {KIND_ORDER.filter((k) => data.byKind[k] > 0).map((k) => {
            const M = KIND_META[k]; const Icon = M.icon
            return (
              <button key={k} onClick={() => setKindFilter(kindFilter === k ? '' : k)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition-all active:scale-95 ${
                  kindFilter === k ? 'bg-stone-800 text-white ring-stone-800' : `${M.cls} hover:brightness-95`}`}>
                <Icon className="size-3.5" />{M.label} {data.byKind[k]}
              </button>
            )
          })}
          <button onClick={copyList} disabled={items.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
            {copied ? <><Check className="size-3.5" />已複製</> : <><Copy className="size-3.5" />複製{checked.size ? ` ${checked.size} 家` : '這份名單'}</>}
          </button>
        </div>
      )}

      {loading && <div className="card-soft p-10 text-center text-sm text-stone-400">整理中…</div>}
      {error && <div className="card-soft p-4 text-sm text-red-600">{error}</div>}

      {!loading && !error && data && data.total === 0 && (
        <div className="card-soft p-10 text-center">
          <p className="font-semibold text-stone-700">目前沒有需要優先跑的客戶</p>
          <p className="mt-1 text-sm text-stone-400">
            {mode === 'today'
              ? '沒有逾期追蹤、也沒有太久沒跑的名下客戶。可以切「指定區域」看看某一區還有誰值得拜訪。'
              : '這一區的客戶都在正常節奏內。'}
          </p>
        </div>
      )}

      {!loading && mode === 'area' && !data && (
        <div className="card-soft p-10 text-center text-sm text-stone-400">選擇縣市與行政區後產生名單。</div>
      )}

      {/* 名單 */}
      {items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((s, idx) => {
            const M = KIND_META[s.kind]; const Icon = M.icon
            return (
              <div key={s.id} className="card-soft p-4">
                <div className="flex items-start gap-3">
                  <label className="flex cursor-pointer items-center pt-0.5">
                    <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)}
                      className="h-4 w-4 accent-[#9a7041]" aria-label={`選取 ${s.name}`} />
                  </label>
                  <span className="w-5 shrink-0 pt-0.5 text-xs font-bold tabular-nums text-stone-300">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/customers/${s.id}`} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-stone-800 hover:text-brand-700">{s.name}</a>
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${M.cls}`}>
                        <Icon className="size-3" />{M.label}
                      </span>
                      {s.type && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">{s.type}</span>}
                      {!s.isMine && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">尚未認領</span>}
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {s.reasons.map((r, i) => (
                        <li key={i} className="text-sm leading-6 text-stone-600">・{r}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-stone-400">
                      {s.city}{s.district}
                      {s.address && ` · ${s.address}`}
                      {s.lastVisit ? ` · 最後拜訪 ${s.lastVisit}` : ' · 尚無拜訪紀錄'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {s.phone && (
                      <a href={telHref(s.phone)} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition-all active:scale-95">
                        <Phone className="size-3" />撥號
                      </a>
                    )}
                    <a href={mapHref(s.name, s.address)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-all active:scale-95">
                      <MapPin className="size-3" />導航
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
          {data && data.total > items.length && kindFilter === '' && (
            <p className="px-1 text-xs text-stone-400">共 {data.total} 家符合條件，這裡顯示分數最高的 {items.length} 家。</p>
          )}
        </div>
      )}
    </div>
  )
}
