'use client'

/**
 * EventCustomersPanel —— 業務首頁「課程／活動客戶」
 *
 * 參加（或報名了）課程、展會，但之後還沒被拜訪的客戶。純檢視，拜訪回報後自動消失，業務不需操作。
 * 主管看全部並標出歸屬；中央管理可把無人負責／公司戶直接指派給業務。
 * 資料規則見 lib/event-customers.ts；地址電話不在此顯示（未認領客戶資料保護）。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Ticket } from 'lucide-react'

type Scope = 'mine' | 'territory' | 'unowned' | 'company' | 'other'
type Item = {
  customerId: string; name: string; type: string; city: string; district: string
  owner: string; territoryOwner: string
  eventName: string; eventDate: string; upcoming: boolean; status: string; source: string
  lastVisit: string; scope: Scope
}

const SCOPE_LABEL: Record<Scope, string> = {
  mine: '我的客戶', territory: '轄區未認領', unowned: '無人負責', company: '公司戶', other: '同事負責',
}
const SCOPE_STYLE: Record<Scope, string> = {
  mine: 'bg-brand-50 text-brand-700', territory: 'bg-emerald-50 text-emerald-700',
  unowned: 'bg-amber-50 text-amber-700', company: 'bg-stone-100 text-stone-600', other: 'bg-stone-50 text-stone-500',
}
const PAGE = 20
const md = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '')

export function EventCustomersPanel() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [viewingAll, setViewingAll] = useState(false)
  const [canAssign, setCanAssign] = useState(false)
  const [canAssignCompany, setCanAssignCompany] = useState(false)
  const [assignable, setAssignable] = useState<string[]>([])
  const [pick, setPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState<'' | Scope>('')
  const [visible, setVisible] = useState(PAGE)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/bd/event-customers')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '讀取失敗')
        if (!alive) return
        setItems(json.items ?? [])
        setViewingAll(Boolean(json.viewingAll))
        setCanAssign(Boolean(json.canAssign))
        setCanAssignCompany(Boolean(json.canAssignCompany))
        setAssignable(json.assignable ?? [])
      })
      .catch((e) => { if (alive) { setError(e?.message ?? '讀取課程客戶失敗'); setItems([]) } })
    return () => { alive = false }
  }, [])

  const counts = useMemo(() => {
    const c: Partial<Record<Scope, number>> = {}
    for (const i of items ?? []) c[i.scope] = (c[i.scope] ?? 0) + 1
    return c
  }, [items])
  const filtered = (items ?? []).filter((i) => !filter || i.scope === filter)

  async function assign(item: Item) {
    const to = pick[item.customerId] || item.territoryOwner
    if (!to) { setError('請先選擇要指派的業務'); return }
    setBusy(item.customerId); setError(''); setDone('')
    try {
      const res = item.scope === 'company'
        ? await fetch('/api/customers/assign-company', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerIds: [item.customerId], from: '公司', to, dryRun: false }),
          })
        : await fetch('/api/bd/claim-suggestions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'assign', customerId: item.customerId, assignTo: to, suggestedTo: item.territoryOwner }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '指派失敗')
      if (item.scope === 'company' && !json.reassigned) throw new Error('指派未生效，該客戶的負責業務已不是公司')
      setItems((prev) => (prev ?? []).map((x) => x.customerId === item.customerId ? { ...x, owner: to, scope: 'other' } : x))
      setDone(`已將 ${item.name} 指派給 ${to}`)
    } catch (e: any) {
      setError(e?.message ?? '指派失敗')
    } finally {
      setBusy('')
    }
  }

  if (items !== null && items.length === 0 && !error) return null

  const upcomingCount = (items ?? []).filter((i) => i.upcoming).length

  return (
    <div className="card-soft p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">行銷活動足跡</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">課程／活動客戶</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            {viewingAll
              ? '參加或報名課程、展會後還沒被拜訪的客戶，標明歸屬。無人負責與公司戶沒有業務看得到，可在這裡指派。'
              : '你的客戶與轄區內未認領客戶中，參加或報名了課程、展會但還沒拜訪的。拜訪回報後會自動消失。'}
          </p>
        </div>
        {items && (
          <div className="flex shrink-0 items-center gap-2">
            {upcomingCount > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">即將上課 {upcomingCount}</span>}
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{items.length} 家</span>
          </div>
        )}
      </div>

      {items === null && <p className="mt-4 text-sm text-stone-400">讀取中…</p>}
      {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      {done && <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{done}</p>}

      {Object.keys(counts).length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <button onClick={() => { setFilter(''); setVisible(PAGE) }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${filter === '' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
            全部 {items?.length}
          </button>
          {(Object.keys(SCOPE_LABEL) as Scope[]).filter((s) => counts[s]).map((s) => (
            <button key={s} onClick={() => { setFilter(s); setVisible(PAGE) }}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${filter === s ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
              {SCOPE_LABEL[s]} {counts[s]}
            </button>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {filtered.slice(0, visible).map((i) => {
            const assignableHere = (i.scope === 'unowned' && canAssign) || (i.scope === 'company' && canAssignCompany)
            return (
              <li key={i.customerId} className="rounded-2xl bg-stone-50 p-3.5 ring-1 ring-stone-900/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/customers/${i.customerId}`} className="block truncate text-sm font-semibold text-stone-800 hover:text-brand-700 hover:underline">{i.name}</Link>
                    <p className="mt-0.5 text-xs text-stone-500">{[i.type, `${i.city}${i.district}`].filter(Boolean).join('・')}</p>
                  </div>
                  {viewingAll && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SCOPE_STYLE[i.scope]}`}>
                      {i.scope === 'other' ? i.owner || i.territoryOwner : SCOPE_LABEL[i.scope]}
                    </span>
                  )}
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-stone-600">
                  {i.upcoming
                    ? <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                    : <Ticket className="mt-0.5 size-3.5 shrink-0 text-brand-600" />}
                  <span>
                    <b className="font-semibold">{md(i.eventDate)}</b>「{i.eventName}」
                    {i.upcoming ? '已報名，可先拜訪提醒出席' : i.status === '已到場' ? '有出席' : '有報名'}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-stone-400">
                  {i.lastVisit ? `上次拜訪 ${i.lastVisit}` : '尚無拜訪紀錄'}
                  {viewingAll && i.scope === 'unowned' && i.territoryOwner && `・轄區 ${i.territoryOwner}（不承接新客戶）`}
                </p>
                {assignableHere && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <select value={pick[i.customerId] ?? ''} onChange={(e) => setPick({ ...pick, [i.customerId]: e.target.value })}
                      className="select-soft min-w-0 flex-1 text-xs">
                      <option value="">指派給…</option>
                      {assignable.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button onClick={() => assign(i)} disabled={busy === i.customerId || !pick[i.customerId]}
                      className="shrink-0 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
                      {busy === i.customerId ? '指派中…' : '指派'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {filtered.length > visible && (
        <button onClick={() => setVisible((v) => v + PAGE)}
          className="mt-3 rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
          再顯示（還有 {filtered.length - visible} 家）
        </button>
      )}
    </div>
  )
}
