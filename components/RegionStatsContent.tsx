'use client'
/**
 * RegionStatsContent — 區域客戶儀表板(/customers/regions)
 *
 * 資料源:頁面 SSR 以 peekRegionStatsRows 注入 initialData(開頁即有,不轉圈);
 * 無快取時才 client fetch 一次。手動「重新統計」走 ?refresh=1(全庫重掃)。
 * 「既有客戶」=負責業務非空;要改定義只動 isExisting。
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  city: string; district: string; type: string; status: string
  salesperson: string; devStage: string; count: number
}
type Data = { rows: Row[]; updatedAt: string }

const NORTH_CITIES = ['臺北市', '新北市', '基隆市', '桃園市', '新竹縣', '新竹市', '宜蘭縣']
const MAIN_TYPES = ['牙醫診所', '牙體技術所', '醫院'] as const
const STATUS_OPTIONS = ['開業', '狀況不明', '停業', '已歇業', '撤銷', '(空白)'] as const

const isExisting = (r: Row) => !!r.salesperson  // 既有客戶=有負責業務

type SortKey = 'district' | 'total' | 'clinics' | 'labs' | 'hospitals' | 'unknown' | 'existing' | 'leads' | 'coverage'

function fmtTime(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  const rel = mins < 60 ? `${mins} 分鐘前` : mins < 1440 ? `${Math.round(mins / 60)} 小時前` : `${Math.round(mins / 1440)} 天前`
  return `${d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}(${rel})`
}

export default function RegionStatsContent({ initialData }: { initialData: Data | null }) {
  const [rows, setRows] = useState<Row[]>(initialData?.rows ?? [])
  const [updatedAt, setUpdatedAt] = useState(initialData?.updatedAt ?? '')
  const [loading, setLoading] = useState(!initialData)   // 有 SSR 資料就不轉圈
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [cities, setCities] = useState<Set<string>>(new Set(NORTH_CITIES))
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [spFilter, setSpFilter] = useState('')
  const [expanded, setExpanded] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })

  const fetchData = useCallback(async (refresh: boolean) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers/region-stats' + (refresh ? '?refresh=1' : ''))
      if (!res.ok) throw new Error((await res.json()).error ?? '讀取失敗')
      const data = await res.json()
      setRows(data.rows ?? [])
      setUpdatedAt(data.updatedAt ?? '')
    } catch (e: any) {
      setError(e?.message ?? '讀取區域統計失敗')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [])

  // 只有 SSR 沒帶資料(冷啟動)才在掛載時補抓一次
  useEffect(() => { if (!initialData) fetchData(false) }, [initialData, fetchData])

  const allCities = useMemo(
    () => Array.from(new Set(rows.map((r) => r.city))).sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [rows])
  const allSalespersons = useMemo(
    () => Array.from(new Set(rows.filter((r) => r.salesperson).map((r) => r.salesperson))).sort(),
    [rows])

  const filtered = useMemo(() => rows.filter((r) =>
    (cities.size === 0 || cities.has(r.city)) &&
    (!typeFilter || (typeFilter === '其他' ? !MAIN_TYPES.includes(r.type as any) : r.type === typeFilter)) &&
    (!statusFilter || r.status === statusFilter) &&
    (!spFilter || r.salesperson === spFilter)
  ), [rows, cities, typeFilter, statusFilter, spFilter])

  const summary = useMemo(() => {
    const base = rows.filter((r) =>
      (cities.size === 0 || cities.has(r.city)) &&
      (!statusFilter || r.status === statusFilter) &&
      (!spFilter || r.salesperson === spFilter))
    const sum = (p: (r: Row) => boolean) => base.filter(p).reduce((s, r) => s + r.count, 0)
    const total = sum(() => true)
    const existing = sum(isExisting)
    return {
      total, clinics: sum((r) => r.type === '牙醫診所'), labs: sum((r) => r.type === '牙體技術所'),
      hospitals: sum((r) => r.type === '醫院'), unknown: sum((r) => r.status === '狀況不明'),
      existing, leads: sum((r) => r.devStage === '線索'),
      coverage: total ? Math.round((existing / total) * 100) : 0,
    }
  }, [rows, cities, statusFilter, spFilter])

  type Agg = {
    city: string; district: string; total: number
    clinics: number; labs: number; hospitals: number; others: number
    unknown: number; existing: number; leads: number; bySp: Record<string, number>
  }
  const districts = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const r of filtered) {
      const key = r.city + '|' + r.district
      let d = map.get(key)
      if (!d) { d = { city: r.city, district: r.district, total: 0, clinics: 0, labs: 0, hospitals: 0, others: 0, unknown: 0, existing: 0, leads: 0, bySp: {} }; map.set(key, d) }
      d.total += r.count
      if (r.type === '牙醫診所') d.clinics += r.count
      else if (r.type === '牙體技術所') d.labs += r.count
      else if (r.type === '醫院') d.hospitals += r.count
      else d.others += r.count
      if (r.status === '狀況不明') d.unknown += r.count
      if (isExisting(r)) { d.existing += r.count; d.bySp[r.salesperson] = (d.bySp[r.salesperson] ?? 0) + r.count }
      if (r.devStage === '線索') d.leads += r.count
    }
    const cov = (d: Agg) => d.total ? d.existing / d.total : 0
    const val = (d: Agg): number | string => sort.key === 'district' ? d.city + d.district
      : sort.key === 'coverage' ? cov(d) : (d as any)[sort.key]
    return Array.from(map.values()).sort((a, b) => {
      const va = val(a), vb = val(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'zh-TW') : (va as number) - (vb as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort])

  const toggleCity = (c: string) => setCities((prev) => {
    const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n
  })
  const toggleSort = (key: SortKey) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'district' ? 'asc' : 'desc' })

  const chip = (active: boolean) => active ? 'chip-active' : 'chip'
  const isNorthAll = NORTH_CITIES.every((c) => cities.has(c)) && cities.size === NORTH_CITIES.length

  if (loading) {
    return (
      <div className="card-soft p-10 text-center">
        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <p className="mt-3 text-sm text-stone-400">正在統計全客戶庫…</p>
      </div>
    )
  }
  if (error && rows.length === 0) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-sm text-rose-500">{error}</p>
        <button onClick={() => fetchData(false)} className="mt-4 px-5 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重試</button>
      </div>
    )
  }

  const SortHead = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`px-3 py-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-stone-600 ${className}`} onClick={() => toggleSort(k)}>
      {label}<span className="ml-0.5 text-stone-300">{sort.key === k ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
    </th>
  )

  return (
    <div className="space-y-5">
      {/* 篩選列 */}
      <div className="card-soft p-5 space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">縣市(可複選)</p>
          <div className="flex flex-wrap gap-2">
            <button className={chip(isNorthAll)} onClick={() => setCities(new Set(NORTH_CITIES))}>北區</button>
            <button className={chip(cities.size === 0)} onClick={() => setCities(new Set())}>全台</button>
            <span className="w-px self-stretch bg-stone-900/[0.06] mx-1" />
            {allCities.map((c) => <button key={c} className={chip(cities.has(c))} onClick={() => toggleCity(c)}>{c}</button>)}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">類型</p>
            <div className="flex flex-wrap gap-2">
              <button className={chip(!typeFilter)} onClick={() => setTypeFilter('')}>全部</button>
              {[...MAIN_TYPES, '其他'].map((t) => <button key={t} className={chip(typeFilter === t)} onClick={() => setTypeFilter(typeFilter === t ? '' : t)}>{t}</button>)}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">機構狀態</p>
            <div className="flex flex-wrap gap-2">
              <button className={chip(!statusFilter)} onClick={() => setStatusFilter('')}>全部</button>
              {STATUS_OPTIONS.map((s) => <button key={s} className={chip(statusFilter === s)} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}>{s}</button>)}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">負責業務</p>
            <select className="select-soft text-sm w-full" value={spFilter} onChange={(e) => setSpFilter(e.target.value)}>
              <option value="">全部業務</option>
              {allSalespersons.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-stone-900/[0.06]">
          <p className="text-[11px] text-stone-400">
            資料時間:{fmtTime(updatedAt)}・「既有客戶」=有負責業務;「線索」=開發階段為線索
          </p>
          <button onClick={() => fetchData(true)} disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-50">
            {refreshing && <span className="w-3 h-3 border-2 border-stone-300 border-t-brand-500 rounded-full animate-spin" />}
            {refreshing ? '重新統計中…' : '↻ 重新統計'}
          </button>
        </div>
      </div>

      {/* 摘要:市場規模 / 我方覆蓋 兩組 */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-soft p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">市場規模(依篩選)</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['總機構', summary.total], ['牙醫', summary.clinics], ['牙技所', summary.labs], ['醫院', summary.hospitals]].map(([l, n]) => (
              <div key={l as string}><p className="text-2xl font-bold text-stone-800">{(n as number).toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">{l}</p></div>
            ))}
          </div>
        </div>
        <div className="card-soft p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">我方覆蓋</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div><p className="text-2xl font-bold text-emerald-600">{summary.existing.toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">既有客戶</p></div>
            <div><p className="text-2xl font-bold text-brand-600">{summary.coverage}%</p><p className="mt-0.5 text-xs text-stone-400">覆蓋率</p></div>
            <div><p className="text-2xl font-bold text-sky-600">{summary.leads.toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">待開發線索</p></div>
            <div><p className="text-2xl font-bold text-amber-600">{summary.unknown.toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">狀況不明</p></div>
          </div>
        </div>
      </div>

      {/* 行政區明細表 */}
      <div className="card-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 border-b border-stone-900/[0.06]">
                <SortHead k="district" label="縣市 / 行政區" className="!px-5 text-left" />
                <SortHead k="total" label="總數" className="text-right" />
                <SortHead k="clinics" label="牙醫" className="text-right" />
                <SortHead k="labs" label="牙技所" className="text-right" />
                <SortHead k="hospitals" label="醫院" className="text-right" />
                <th className="px-3 py-3 font-medium text-right">其他</th>
                <SortHead k="unknown" label="狀況不明" className="text-right !text-amber-500" />
                <SortHead k="existing" label="既有客戶" className="text-right !text-emerald-600" />
                <SortHead k="leads" label="線索" className="text-right !text-sky-600" />
                <SortHead k="coverage" label="覆蓋率" className="text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.04]">
              {districts.map((d) => {
                const key = d.city + '|' + d.district
                const open = expanded === key
                const spEntries = Object.entries(d.bySp).sort((a, b) => b[1] - a[1])
                const coverage = d.total > 0 ? Math.round((d.existing / d.total) * 100) : 0
                return (
                  <Fragment key={key}>
                    <tr className="hover:bg-brand-50/50 cursor-pointer transition-colors" onClick={() => setExpanded(open ? '' : key)}>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-xs text-stone-400">{d.city}</span>
                        <span className="ml-2 font-semibold text-stone-800">{d.district}</span>
                        <span className="ml-1.5 text-xs text-stone-300">{open ? '▾' : '▸'}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold">{d.total.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.clinics.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.labs.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.hospitals || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right text-stone-400">{d.others || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right text-amber-600">{d.unknown || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-600">{d.existing.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-sky-600">{d.leads || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-12 h-1.5 rounded-full bg-stone-100 overflow-hidden"><span className="block h-full bg-brand-500" style={{ width: `${Math.min(coverage, 100)}%` }} /></span>
                          <span className="text-xs text-stone-500 w-9 text-right">{coverage}%</span>
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-stone-50/60">
                        <td colSpan={10} className="px-5 py-4">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{d.city}{d.district}・各業務既有客戶數</p>
                          {spEntries.length === 0 ? (
                            <p className="mt-2 text-sm text-stone-400">此轄區尚無指派負責業務的客戶</p>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {spEntries.map(([sp, n]) => (
                                <span key={sp} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white ring-1 ring-stone-900/[0.08] text-sm">
                                  <span className="font-medium text-stone-700">{sp}</span>
                                  <span className="font-bold text-brand-600">{n}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {districts.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-stone-400">目前篩選條件下沒有資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-stone-900/[0.06] text-xs text-stone-400">
          共 {districts.length} 個行政區・點任一列展開各業務轄區客戶數・點欄位標題可排序
        </div>
      </div>
    </div>
  )
}
