'use client'

import Link from 'next/link'
import { MapPinned, ArrowRight, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type CustomerType = '牙醫診所' | '牙體技術所' | '醫院'
type Territory = {
  id: string; city: string; district: string; salesperson: string; status: string
}
type Area = {
  city: string; district: string; marketTotal: number; byType: Record<CustomerType, number>
}
const TYPES: { value: '' | CustomerType; label: string }[] = [
  { value: '', label: '全部' },
  { value: '牙醫診所', label: '牙醫診所' },
  { value: '牙體技術所', label: '牙體技術所' },
  { value: '醫院', label: '醫院' },
]

export default function MyTerritoriesPanel() {
  const [territories, setTerritories] = useState<Territory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [type, setType] = useState<'' | CustomerType>('')
  const [salesperson, setSalesperson] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/bd/territories').then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取轄區失敗')
      setTerritories(json.items ?? [])
      setAreas(json.areas ?? [])
      setScope(json.scope === 'team' ? 'team' : 'mine')
    }).catch((caught) => setError(caught.message)).finally(() => setLoading(false))
  }, [])

  const people = useMemo(() => Array.from(new Set(territories.map((item) => item.salesperson))).sort((a, b) => a.localeCompare(b, 'zh-TW')), [territories])
  const visible = useMemo(() => territories.filter((item) => !salesperson || item.salesperson === salesperson), [salesperson, territories])
  const areaMap = useMemo(() => new Map(areas.map((area) => [`${area.city}|${area.district}`, area])), [areas])
  const marketCount = (territory: Territory) => {
    const area = areaMap.get(`${territory.city}|${territory.district}`)
    if (!area) return 0
    return type ? area.byType[type] : area.marketTotal
  }
  const total = visible.reduce((sum, territory) => sum + marketCount(territory), 0)

  if (loading) return <section className="card-soft p-6 text-center text-sm text-stone-400">載入負責轄區…</section>
  if (error) return <section className="card-soft p-5 text-sm text-red-600">{error}</section>

  return (
    <section className="card-soft overflow-hidden" aria-labelledby="my-territories-title">
      <div className="p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><MapPinned className="size-5" /></span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">負責市場</p>
              <h2 id="my-territories-title" className="mt-1 text-xl font-bold text-stone-800">{scope === 'team' ? '團隊轄區' : '我的轄區'}</h2>
              <p className="mt-1 text-sm text-stone-500">選擇客戶類型，立即看目前負責區域的市場規模。</p>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {TYPES.map((option) => <button key={option.value || 'all'} onClick={() => setType(option.value)} className={`min-w-max rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${type === option.value ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'}`}>{option.label}</button>)}
          </div>
        </div>

        {scope === 'team' && people.length > 1 && <div className="mt-4 max-w-56"><select className="select-soft block w-full" value={salesperson} onChange={(event) => setSalesperson(event.target.value)}><option value="">全部業務</option>{people.map((name) => <option key={name}>{name}</option>)}</select></div>}

        {visible.length === 0 ? (
          <div className="mt-5 rounded-2xl bg-stone-50 px-5 py-7 text-center"><p className="font-semibold text-stone-600">目前尚未設定轄區</p><p className="mt-1 text-sm text-stone-400">請主管至業務轄區管理新增負責區域。</p></div>
        ) : (
          <>
            <div className="mt-5 flex items-end justify-between"><p className="text-sm text-stone-500">{visible.length} 個行政區</p><p className="text-sm text-stone-500">{type || '全部類型'}市場 <b className="text-xl text-brand-700">{total.toLocaleString()}</b> 家</p></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((territory) => <article key={territory.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05]"><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-stone-800">{territory.city}{territory.district}</h3>{scope === 'team' && <p className="mt-0.5 text-xs text-stone-400">{territory.salesperson}</p>}</div><div className="text-right"><p className="text-xl font-bold text-brand-700">{marketCount(territory).toLocaleString()}</p><p className="text-[11px] text-stone-400">{type || '全部市場'}</p></div></div><Link href={`/bd/territories/${territory.id}/report${type ? `?type=${encodeURIComponent(type)}` : ''}`} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-full bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95"><Printer className="size-3.5" />列印名單／統計</Link></article>)}
            </div>
          </>
        )}
      </div>
      <Link href="/bd?tab=suggest" className="flex min-h-14 items-center justify-between border-t border-stone-900/[0.06] px-5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50/50 active:scale-[0.99] sm:px-7"><span>依轄區安排拜訪建議</span><ArrowRight className="size-4" /></Link>
    </section>
  )
}
