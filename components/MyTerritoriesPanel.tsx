'use client'

import Link from 'next/link'
import { MapPinned, ArrowRight, ListFilter, Users, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type CustomerType = '牙醫診所' | '牙體技術所' | '醫院'
type Territory = {
  id: string; city: string; district: string; salesperson: string; status: string
}
type Area = {
  city: string; district: string; marketTotal: number; byType: Record<CustomerType, number>
}
type CustomerListItem = {
  id: string; name: string; city: string; district: string; type: string
  status: string; devStage: string; salesperson: string
}
type CustomerDetail = CustomerListItem & {
  address: string; phone: string
  dentistCount: number; technicianCount: number; technicianTraineeCount: number
}
type ListArea = { id: string; city: string; district: string; salesperson: string }
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
  const [assignmentMode, setAssignmentMode] = useState('全面開發')
  const [type, setType] = useState<'' | CustomerType>('')
  const [salesperson, setSalesperson] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listDialog, setListDialog] = useState<{ scope: 'territories' | 'customers'; area?: ListArea } | null>(null)
  const [listItems, setListItems] = useState<CustomerListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [listType, setListType] = useState<'' | CustomerType>('')
  const [listSearch, setListSearch] = useState('')
  const [detailId, setDetailId] = useState('')
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const listRequestRef = useRef<AbortController | null>(null)
  const detailRequestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/bd/territories').then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取轄區失敗')
      setTerritories(json.items ?? [])
      setAreas(json.areas ?? [])
      setScope(json.scope === 'team' ? 'team' : 'mine')
      setAssignmentMode(json.assignmentMode ?? '全面開發')
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

  const closeList = useCallback(() => {
    listRequestRef.current?.abort()
    detailRequestRef.current?.abort()
    listRequestRef.current = null
    detailRequestRef.current = null
    setListDialog(null)
  }, [])

  const openList = async (nextScope: 'territories' | 'customers', area?: ListArea) => {
    listRequestRef.current?.abort()
    const controller = new AbortController()
    listRequestRef.current = controller
    setListDialog({ scope: nextScope, area })
    setListItems([])
    setListError('')
    setListSearch('')
    setListType(type)
    setDetailId('')
    setDetail(null)
    setDetailError('')
    setListLoading(true)
    try {
      const query = new URLSearchParams({ scope: nextScope })
      if (area?.id) query.set('territoryId', area.id)
      const response = await fetch(`/api/bd/my-customer-list?${query}`, { signal: controller.signal })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取清單失敗')
      if (controller.signal.aborted || listRequestRef.current !== controller) return
      setListItems(json.items ?? [])
    } catch (caught: any) {
      if (caught?.name === 'AbortError' || listRequestRef.current !== controller) return
      setListError(caught.message)
    } finally {
      if (listRequestRef.current === controller) {
        listRequestRef.current = null
        setListLoading(false)
      }
    }
  }

  const toggleDetail = async (customerId: string) => {
    if (detailId === customerId) {
      detailRequestRef.current?.abort()
      detailRequestRef.current = null
      setDetailId('')
      setDetail(null)
      setDetailError('')
      return
    }
    detailRequestRef.current?.abort()
    const controller = new AbortController()
    detailRequestRef.current = controller
    setDetailId(customerId)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/bd/customer-detail/${encodeURIComponent(customerId)}`, { signal: controller.signal })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取客戶詳細資料失敗')
      if (controller.signal.aborted || detailRequestRef.current !== controller) return
      setDetail(json.customer ?? null)
    } catch (caught: any) {
      if (caught?.name === 'AbortError' || detailRequestRef.current !== controller) return
      setDetailError(caught.message)
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = null
        setDetailLoading(false)
      }
    }
  }

  const visibleListItems = useMemo(() => listItems.filter((item) =>
    (!listDialog?.area || (item.city === listDialog.area.city && item.district === listDialog.area.district)) &&
    (!listType || item.type === listType) &&
    (!listSearch.trim() || `${item.name}${item.city}${item.district}${item.type}`.toLowerCase().includes(listSearch.trim().toLowerCase()))
  ), [listDialog, listItems, listSearch, listType])

  useEffect(() => {
    if (!listDialog) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') closeList() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', close) }
  }, [closeList, listDialog])

  useEffect(() => () => {
    listRequestRef.current?.abort()
    detailRequestRef.current?.abort()
  }, [])

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
              <h2 id="my-territories-title" className="mt-1 text-xl font-bold text-stone-800">
                {scope === 'team' ? '團隊轄區' : assignmentMode === '既有客戶維護' ? '既有客戶維護' : '我的轄區'}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                {scope === 'mine' && assignmentMode === '既有客戶維護' ? '專注服務目前名下客戶，不另外配置陌生開發轄區。' : '選擇客戶類型，立即看目前負責區域的市場規模。'}
              </p>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {TYPES.map((option) => <button key={option.value || 'all'} onClick={() => setType(option.value)} className={`min-w-max rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${type === option.value ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'}`}>{option.label}</button>)}
          </div>
        </div>

        {scope === 'team' && people.length > 1 && <div className="mt-4 max-w-56"><select className="select-soft block w-full" value={salesperson} onChange={(event) => setSalesperson(event.target.value)}><option value="">全部業務</option>{people.map((name) => <option key={name}>{name}</option>)}</select></div>}

        {scope === 'mine' && (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {territories.length > 0 ? <button onClick={() => openList('territories')} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95"><ListFilter className="size-4" />查看全部轄區名單</button> : <div className="flex min-h-12 items-center justify-center rounded-full bg-stone-50 px-4 py-2.5 text-sm text-stone-400">目前沒有轄區名單</div>}
            <button onClick={() => openList('customers')} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-600 active:scale-95"><Users className="size-4" />查看既有客戶名單</button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="mt-5 rounded-2xl bg-stone-50 px-5 py-7 text-center">
            {scope === 'mine' && assignmentMode === '既有客戶維護' ? (
              <><p className="font-semibold text-stone-700">目前只維護既有客戶</p><p className="mt-1 text-sm text-stone-400">不需要設定轄區；客情紀錄、報價與訂單仍可照常使用。</p></>
            ) : (
              <><p className="font-semibold text-stone-600">目前尚未設定轄區</p><p className="mt-1 text-sm text-stone-400">請主管至業務轄區管理新增負責區域。</p></>
            )}
          </div>
        ) : (
          <>
            <div className="mt-5 flex items-end justify-between"><p className="text-sm text-stone-500">{visible.length} 個行政區</p><p className="text-sm text-stone-500">{type || '全部類型'}市場 <b className="text-xl text-brand-700">{total.toLocaleString()}</b> 家</p></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((territory) => <article key={territory.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05]"><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-stone-800">{territory.city}{territory.district}</h3>{scope === 'team' && <p className="mt-0.5 text-xs text-stone-400">{territory.salesperson}</p>}</div><div className="text-right"><p className="text-xl font-bold text-brand-700">{marketCount(territory).toLocaleString()}</p><p className="text-[11px] text-stone-400">{type || '全部市場'}</p></div></div><button onClick={() => openList('territories', { id: territory.id, city: territory.city, district: territory.district, salesperson: territory.salesperson })} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95"><ListFilter className="size-3.5" />{scope === 'team' ? `查看 ${territory.salesperson} 客戶` : '查看我的客戶'}</button></article>)}
            </div>
          </>
        )}
      </div>
      <Link href="/bd?tab=suggest" className="flex min-h-14 items-center justify-between border-t border-stone-900/[0.06] px-5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50/50 active:scale-[0.99] sm:px-7"><span>{scope === 'mine' && assignmentMode === '既有客戶維護' ? '安排既有客戶拜訪' : '依轄區安排拜訪建議'}</span><ArrowRight className="size-4" /></Link>

      {listDialog && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-950/30 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="customer-list-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeList() }}>
          <section className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-stone-900/[0.08] sm:rounded-3xl">
            <header className="flex items-start gap-3 border-b border-stone-900/[0.06] px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">客戶清單</p><h2 id="customer-list-title" className="mt-1 text-xl font-bold text-stone-800">{listDialog.area ? `${listDialog.area.city}${listDialog.area.district}｜${listDialog.area.salesperson}` : listDialog.scope === 'customers' ? '我的既有客戶' : '我的全部轄區'}</h2><p className="mt-1 text-sm text-stone-400">{listDialog.area ? `只顯示 ${listDialog.area.salesperson} 名下的客戶` : '只顯示你名下的客戶'}，共 {visibleListItems.length.toLocaleString()} 家。</p></div>
              <button onClick={closeList} aria-label="關閉清單" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-500 transition-all hover:bg-stone-100 active:scale-95"><X className="size-4" /></button>
            </header>
            <div className="border-b border-stone-900/[0.06] px-5 py-3 sm:px-6"><input className="input-soft block w-full" value={listSearch} onChange={(event) => setListSearch(event.target.value)} placeholder="搜尋客戶名稱、地區或類型" /><div className="mt-3 flex gap-1 overflow-x-auto">{TYPES.map((option) => <button key={option.value || 'all'} onClick={() => setListType(option.value)} className={`min-w-max rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${listType === option.value ? 'bg-brand-500 text-white' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'}`}>{option.label}</button>)}</div></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
              {listLoading && <div className="py-12 text-center text-sm text-stone-400">正在整理客戶清單…</div>}
              {listError && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">{listError}</div>}
              {!listLoading && !listError && <div className="space-y-2">{visibleListItems.map((item) => <article key={item.id} className="rounded-2xl bg-stone-50/80 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-bold text-stone-800">{item.name}</h3><p className="mt-1 text-xs text-stone-400">{item.city || '未填縣市'}{item.district || ''}</p></div><span className="chip shrink-0 text-[11px]">{item.type || '未分類'}</span></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-500"><span className="rounded-full bg-white px-2.5 py-1">{item.status || '狀態未標示'}</span><span className="rounded-full bg-white px-2.5 py-1">{item.devStage || '尚未設定階段'}</span><span className="rounded-full bg-white px-2.5 py-1">{item.salesperson || '尚未認領'}</span></div><button onClick={() => toggleDetail(item.id)} className="mt-3 flex min-h-10 w-full items-center justify-center rounded-full bg-white px-3 py-2 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-stone-900/[0.05] transition-all hover:bg-brand-50 active:scale-95">{detailId === item.id ? '收起詳細資料' : '查看詳細資料'}</button>{detailId === item.id && <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-stone-900/[0.05]">{detailLoading && <p className="py-4 text-center text-xs text-stone-400">讀取詳細資料…</p>}{detailError && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-600">{detailError}</p>}{detail && <div className="space-y-3 text-sm"><div><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">內部機密</p><p className="mt-1 text-stone-700">{detail.address || '未填寫地址'}</p><p className="mt-1 font-semibold text-stone-800">{detail.phone || '未填寫電話'}</p></div><div className="grid grid-cols-3 gap-2"><SmallDetail label="牙醫師" value={detail.dentistCount} /><SmallDetail label="技術師" value={detail.technicianCount} /><SmallDetail label="技術生" value={detail.technicianTraineeCount} /></div><p className="text-xs text-stone-400">僅限負責業務與授權主管使用。</p></div>}</div>}</article>)}{visibleListItems.length === 0 && <div className="py-12 text-center text-sm text-stone-400">此條件下沒有客戶</div>}</div>}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function SmallDetail({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-stone-50 px-2 py-2.5 text-center"><p className="font-bold text-stone-700">{value.toLocaleString()}</p><p className="mt-0.5 text-[10px] text-stone-400">{label}</p></div>
}
