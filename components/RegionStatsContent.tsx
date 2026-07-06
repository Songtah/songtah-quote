'use client'
/**
 * RegionStatsContent — 區域客戶儀表板(/customers/regions)
 *
 * 資料源:/api/customers/region-stats(全庫分組計數,Redis 快取 1hr)。
 * 視角:各鄉鎮市區的客戶規模 × 類型/機構狀態/負責業務/開發階段交叉篩選;
 * 點開行政區列展開「該轄區各業務的客戶數」。
 * 「既有客戶」定義=負責業務非空(未指派者視為名錄/線索),要改定義只動 isExisting。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  city: string; district: string; type: string; status: string
  salesperson: string; devStage: string; count: number
}

const NORTH_CITIES = ['臺北市', '新北市', '基隆市', '桃園市', '新竹縣', '新竹市', '宜蘭縣']
const MAIN_TYPES = ['牙醫診所', '牙體技術所', '醫院'] as const
const STATUS_OPTIONS = ['開業', '狀況不明', '停業', '已歇業', '撤銷', '(空白)'] as const

const isExisting = (r: Row) => !!r.salesperson  // 既有客戶=有負責業務

export default function RegionStatsContent() {
  const [rows, setRows] = useState<Row[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 篩選狀態
  const [cities, setCities] = useState<Set<string>>(new Set(NORTH_CITIES))
  const [typeFilter, setTypeFilter] = useState<string>('')       // ''=全部
  const [statusFilter, setStatusFilter] = useState<string>('')   // ''=全部
  const [spFilter, setSpFilter] = useState<string>('')           // ''=全部業務
  const [expanded, setExpanded] = useState<string>('')           // 展開的 city|district

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const allCities = useMemo(() => {
    const s = new Set(rows.map((r) => r.city))
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-TW'))
  }, [rows])

  const allSalespersons = useMemo(() => {
    const s = new Set(rows.filter((r) => r.salesperson).map((r) => r.salesperson))
    return Array.from(s).sort()
  }, [rows])

  // 套用篩選後的列
  const filtered = useMemo(() => rows.filter((r) =>
    (cities.size === 0 || cities.has(r.city)) &&
    (!typeFilter || (typeFilter === '其他' ? !MAIN_TYPES.includes(r.type as any) : r.type === typeFilter)) &&
    (!statusFilter || r.status === statusFilter) &&
    (!spFilter || r.salesperson === spFilter)
  ), [rows, cities, typeFilter, statusFilter, spFilter])

  // 摘要卡(依目前篩選,但類型卡不受類型篩選影響以便對照)
  const summary = useMemo(() => {
    const base = rows.filter((r) =>
      (cities.size === 0 || cities.has(r.city)) &&
      (!statusFilter || r.status === statusFilter) &&
      (!spFilter || r.salesperson === spFilter)
    )
    const sum = (pred: (r: Row) => boolean) => base.filter(pred).reduce((s, r) => s + r.count, 0)
    return {
      total:    sum(() => true),
      clinics:  sum((r) => r.type === '牙醫診所'),
      labs:     sum((r) => r.type === '牙體技術所'),
      hospitals:sum((r) => r.type === '醫院'),
      unknown:  sum((r) => r.status === '狀況不明'),
      existing: sum(isExisting),
      leads:    sum((r) => r.devStage === '線索'),
    }
  }, [rows, cities, statusFilter, spFilter])

  // 行政區彙總表
  type DistrictAgg = {
    city: string; district: string; total: number
    clinics: number; labs: number; hospitals: number; others: number
    unknown: number; existing: number; leads: number
    bySp: Record<string, number>
  }
  const districts = useMemo(() => {
    const map = new Map<string, DistrictAgg>()
    for (const r of filtered) {
      const key = r.city + '|' + r.district
      let d = map.get(key)
      if (!d) {
        d = { city: r.city, district: r.district, total: 0, clinics: 0, labs: 0, hospitals: 0, others: 0, unknown: 0, existing: 0, leads: 0, bySp: {} }
        map.set(key, d)
      }
      d.total += r.count
      if (r.type === '牙醫診所') d.clinics += r.count
      else if (r.type === '牙體技術所') d.labs += r.count
      else if (r.type === '醫院') d.hospitals += r.count
      else d.others += r.count
      if (r.status === '狀況不明') d.unknown += r.count
      if (isExisting(r)) {
        d.existing += r.count
        d.bySp[r.salesperson] = (d.bySp[r.salesperson] ?? 0) + r.count
      }
      if (r.devStage === '線索') d.leads += r.count
    }
    return Array.from(map.values()).sort((a, b) =>
      a.city.localeCompare(b.city, 'zh-TW') || b.total - a.total)
  }, [filtered])

  function toggleCity(c: string) {
    setCities((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-stone-400">統計全客戶庫中…(首次載入約 1–2 分鐘,之後有 1 小時快取)</div>
  }
  if (error) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-sm text-rose-500">{error}</p>
        <button onClick={() => load()} className="mt-4 px-5 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重試</button>
      </div>
    )
  }

  const chip = (active: boolean) => active ? 'chip-active' : 'chip'

  return (
    <div className="space-y-6">
      {/* 篩選列 */}
      <div className="card-soft p-5 space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">縣市(可複選)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={chip(cities.size === NORTH_CITIES.length && NORTH_CITIES.every((c) => cities.has(c)))} onClick={() => setCities(new Set(NORTH_CITIES))}>北區</button>
            <button className={chip(cities.size === 0)} onClick={() => setCities(new Set())}>全台</button>
            {allCities.map((c) => (
              <button key={c} className={chip(cities.has(c))} onClick={() => toggleCity(c)}>{c}</button>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">類型</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={chip(!typeFilter)} onClick={() => setTypeFilter('')}>全部</button>
              {[...MAIN_TYPES, '其他'].map((t) => (
                <button key={t} className={chip(typeFilter === t)} onClick={() => setTypeFilter(typeFilter === t ? '' : t)}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">機構狀態</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={chip(!statusFilter)} onClick={() => setStatusFilter('')}>全部</button>
              {STATUS_OPTIONS.map((s) => (
                <button key={s} className={chip(statusFilter === s)} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">負責業務</p>
            <select className="mt-2 select-soft text-sm" value={spFilter} onChange={(e) => setSpFilter(e.target.value)}>
              <option value="">全部業務</option>
              {allSalespersons.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-stone-400">
          資料時間:{updatedAt ? updatedAt.slice(0, 16).replace('T', ' ') : '—'}
          <button onClick={() => load(true)} className="ml-2 text-brand-600 hover:text-brand-700">重新統計</button>
          ・「既有客戶」=負責業務非空;「線索」=開發階段為線索(含 BAS 匯入待開發)
        </p>
      </div>

      {/* 摘要卡 */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        {[
          ['總機構數', summary.total, 'text-stone-800'],
          ['牙醫診所', summary.clinics, 'text-stone-800'],
          ['牙體技術所', summary.labs, 'text-stone-800'],
          ['醫院', summary.hospitals, 'text-stone-800'],
          ['狀況不明', summary.unknown, 'text-amber-600'],
          ['既有客戶', summary.existing, 'text-emerald-600'],
          ['待開發線索', summary.leads, 'text-sky-600'],
        ].map(([label, n, color]) => (
          <div key={label as string} className="card-soft p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{(n as number).toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-stone-400">{label}</p>
          </div>
        ))}
      </div>

      {/* 行政區明細表 */}
      <div className="card-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 border-b border-stone-900/[0.06]">
                <th className="px-5 py-3 font-medium">縣市 / 行政區</th>
                <th className="px-3 py-3 font-medium text-right">總數</th>
                <th className="px-3 py-3 font-medium text-right">牙醫</th>
                <th className="px-3 py-3 font-medium text-right">牙技所</th>
                <th className="px-3 py-3 font-medium text-right">醫院</th>
                <th className="px-3 py-3 font-medium text-right">其他</th>
                <th className="px-3 py-3 font-medium text-right text-amber-500">狀況不明</th>
                <th className="px-3 py-3 font-medium text-right text-emerald-600">既有客戶</th>
                <th className="px-3 py-3 font-medium text-right text-sky-600">線索</th>
                <th className="px-3 py-3 font-medium text-right">覆蓋率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.04]">
              {districts.map((d) => {
                const key = d.city + '|' + d.district
                const spEntries = Object.entries(d.bySp).sort((a, b) => b[1] - a[1])
                const coverage = d.total > 0 ? Math.round((d.existing / d.total) * 100) : 0
                return (
                  <>
                    <tr key={key} className="hover:bg-brand-50/50 cursor-pointer transition-colors" onClick={() => setExpanded(expanded === key ? '' : key)}>
                      <td className="px-5 py-3">
                        <span className="text-xs text-stone-400">{d.city}</span>
                        <span className="ml-2 font-semibold text-stone-800">{d.district}</span>
                        <span className="ml-1.5 text-xs text-stone-300">{expanded === key ? '▾' : '▸'}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold">{d.total.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.clinics.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.labs.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.hospitals.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-stone-400">{d.others.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-amber-600">{d.unknown || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-600">{d.existing.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-sky-600">{d.leads.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-14 h-1.5 rounded-full bg-stone-100 overflow-hidden"><span className="block h-full bg-brand-500" style={{ width: `${Math.min(coverage, 100)}%` }} /></span>
                          <span className="text-xs text-stone-500 w-9 text-right">{coverage}%</span>
                        </span>
                      </td>
                    </tr>
                    {expanded === key && (
                      <tr key={key + ':sp'} className="bg-stone-50/60">
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
                  </>
                )
              })}
              {districts.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-stone-400">目前篩選條件下沒有資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
