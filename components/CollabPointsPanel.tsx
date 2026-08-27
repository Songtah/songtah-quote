'use client'

/**
 * 業務協作積分（《業務客戶分區管理辦法 2026v4》第八章）。
 * 積分全體可見，故排行不分權限一律顯示。
 * 認列流程：助攻者申報 → 受助業務確認 → 總經理認列，三步都在這個面板完成。
 */
import { useCallback, useEffect, useState } from 'react'
import { Trophy, Plus, Check, X, Link2 } from 'lucide-react'
import { CustomerPickerInline } from '@/components/CustomerPickerInline'

type Period = 'week' | 'month' | 'quarter' | 'year'

const TABS: { value: Period; label: string }[] = [
  { value: 'week', label: '本週' },
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '本季' },
  { value: 'year', label: '今年' },
]

type Item = {
  id: string; helper: string; helped: string
  customerName: string; customerCity: string
  item: string; points: number; status: string
  countedDate: string; note: string
  autoClassified: boolean
  customerMatched: boolean
}

type Data = {
  me: string
  focus: string
  periodLabel: string
  range: { from: string; to: string; label: string }
  summary: {
    totalPoints: number; completedCycles: number; cyclePoints: number
    nextTier: { points: number; reward: string } | null
    pointsToNextTier: number
    reachedTiers: { points: number; reward: string }[]
  }
  items: Item[]
  ranking: { name: string; points: number; entries: number }[]
  salespeople: string[]
  pendingForMe: Item[]
  pendingByMe: Item[]
  itemOptions: { name: string; points: number }[]
  rewardTiers: { points: number; reward: string }[]
}

export function CollabPointsPanel() {
  const [period, setPeriod] = useState<Period>('quarter')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  // 待確認項目的人工更正（key = 紀錄 id）
  const [correction, setCorrection] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState('')
  const [form, setForm] = useState({ helped: '', item: '', customerName: '', caseKey: '', note: '' })

  const load = useCallback((next: Period, signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    fetch(`/api/dashboard/collab-points?period=${next}`, { signal })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || '讀取協作積分失敗')
        setData(json)
      })
      .catch((caught: any) => { if (caught?.name !== 'AbortError') setError(caught.message) })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(period, controller.signal)
    return () => controller.abort()
  }, [period, load])

  async function submitReport() {
    if (!form.helped || !form.item) { setNotice('請選擇受助業務與助攻項目'); return }
    setBusy('report'); setNotice('')
    try {
      const response = await fetch('/api/dashboard/collab-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '申報失敗')
      setNotice(
        `已申報 ${json.points} 點，待 ${form.helped} 確認`
        + (form.customerName && !json.customerMatched ? '（客戶名稱未比對到，已留空）' : ''),
      )
      setForm({ helped: '', item: '', customerName: '', caseKey: '', note: '' })
      setFormOpen(false)
      load(period)
    } catch (caught: any) {
      setNotice(caught.message)
    } finally { setBusy('') }
  }

  async function changeStatus(id: string, status: string, overrideDuplicate = false) {
    setBusy(id); setNotice('')
    try {
      const response = await fetch(`/api/dashboard/collab-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // 確認前若在下拉改過項目，一併送出更正（積分由後端依項目重算）
        body: JSON.stringify({ status, overrideDuplicate, item: correction[id] ?? '' }),
      })
      const json = await response.json()
      if (!response.ok) {
        if (json.duplicate && confirm(`${json.error}\n\n仍要認列嗎？`)) {
          return changeStatus(id, status, true)
        }
        throw new Error(json.error || '更新失敗')
      }
      setNotice(`已更新為「${status}」`)
      load(period)
    } catch (caught: any) {
      setNotice(caught.message)
    } finally { setBusy('') }
  }

  async function assignCustomer(id: string, customer: { id: string; name: string }) {
    setBusy(id); setNotice('')
    try {
      const response = await fetch(`/api/dashboard/collab-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, customerName: customer.name }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '指定客戶失敗')
      setNotice(`已指定客戶：${customer.name}`)
      setPicking('')
      load(period)
    } catch (caught: any) {
      setNotice(caught.message)
    } finally { setBusy('') }
  }

  const s = data?.summary

  return (
    <section className="card-soft overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6 sm:px-7">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">COLLABORATION POINTS</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-stone-800">
            <Trophy className="size-4.5 text-brand-600" />協作積分
            {data && <span className="text-sm font-semibold text-brand-700">{data.focus}</span>}
          </h2>
        </div>
        <button
          onClick={() => { setFormOpen((open) => !open); setNotice('') }}
          className="flex min-h-10 items-center gap-1.5 rounded-full bg-brand-500 px-4 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-600 active:scale-95"
        >
          <Plus className="size-4" />申報助攻
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto px-6 pt-4 sm:px-7">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setPeriod(tab.value)}
            className={`min-w-max rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
              period === tab.value ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {notice && <p className="mx-6 mt-4 rounded-2xl bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 sm:mx-7">{notice}</p>}

      {formOpen && data && (
        <div className="mx-6 mt-4 rounded-2xl bg-stone-50 p-4 sm:mx-7">
          <p className="text-sm font-bold text-stone-700">申報助攻</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-stone-500">受助業務
              <select className="select-soft mt-1.5 block w-full" value={form.helped} onChange={(e) => setForm({ ...form, helped: e.target.value })}>
                <option value="">請選擇</option>
                {data.salespeople.filter((n) => n !== data.me).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-500">助攻項目
              <select className="select-soft mt-1.5 block w-full" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}>
                <option value="">請選擇</option>
                {data.itemOptions.map((o) => <option key={o.name} value={o.name}>{o.name}（+{o.points}）</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-500">客戶名稱（選填）
              <input className="input-soft mt-1.5 block w-full" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="比對不到會留空，不影響申報" />
            </label>
            <label className="text-xs font-semibold text-stone-500">案件識別（選填）
              <input className="input-soft mt-1.5 block w-full" value={form.caseKey} onChange={(e) => setForm({ ...form, caseKey: e.target.value })} placeholder="同一案件僅認列一次的判斷依據" />
            </label>
          </div>
          <label className="mt-3 block text-xs font-semibold text-stone-500">助攻事蹟
            <textarea className="input-soft mt-1.5 block w-full" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button
            onClick={submitReport}
            disabled={busy === 'report'}
            className="mt-3 flex min-h-10 items-center rounded-full bg-stone-900 px-5 text-sm font-semibold text-white transition-all hover:bg-stone-800 active:scale-95 disabled:opacity-50"
          >
            {busy === 'report' ? '送出中…' : '送出申報'}
          </button>
        </div>
      )}

      {loading && <p className="px-6 py-10 text-center text-sm text-stone-400 sm:px-7">讀取協作積分…</p>}
      {error && <p className="mx-6 my-5 rounded-2xl bg-red-50 p-4 text-sm text-red-600 sm:mx-7">{error}</p>}

      {!loading && !error && data && s && (
        <div className="px-6 py-5 sm:px-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">{data.periodLabel}積分</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-brand-700">{s.totalPoints}</p>
              <p className="mt-1 text-[11px] text-stone-400">{data.items.length} 筆已認列</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">本輪累計</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-stone-900">{s.cyclePoints}<span className="text-base font-medium text-stone-400"> / 12</span></p>
              <p className="mt-1 text-[11px] text-stone-400">達 12 點後歸零重算</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">距下個獎勵</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-stone-900">{s.nextTier ? s.pointsToNextTier : '—'}</p>
              <p className="mt-1 text-[11px] text-stone-400">{s.nextTier ? `再 ${s.pointsToNextTier} 點達 ${s.nextTier.points} 點` : '本輪已達頂'}</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">已完成輪次</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-stone-900">{s.completedCycles}</p>
              <p className="mt-1 text-[11px] text-stone-400">每輪 12 點</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {data.rewardTiers.map((tier) => (
              <span key={tier.points} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${s.cyclePoints >= tier.points ? 'bg-brand-500 text-white' : 'bg-stone-100 text-stone-500'}`}>
                {tier.points} 點・{tier.reward}
              </span>
            ))}
          </div>

          {data.pendingForMe.length > 0 && (
            <div className="mt-5 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-sm font-bold text-amber-800">待你確認（{data.pendingForMe.length}）</p>
              <div className="mt-2 space-y-2">
                {data.pendingForMe.map((item) => (
                  <div key={item.id} className="rounded-xl bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-800">
                        {item.helper}｜{correction[item.id] || item.item}
                        {' '}<span className="text-brand-700">+{data.itemOptions.find((o) => o.name === (correction[item.id] || item.item))?.points ?? item.points}</span>
                        {item.autoClassified && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">系統判定・請複核</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-400">
                        {item.customerName || '未指定客戶'}{item.note ? `・${item.note}` : ''}
                        {!item.customerMatched && picking !== item.id && (
                          <button onClick={() => { setPicking(item.id); setNotice('') }} className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white active:scale-95">
                            <Link2 className="size-2.5" />指定客戶
                          </button>
                        )}
                      </p>
                      {picking === item.id && (
                        <CustomerPickerInline busy={busy === item.id} onPick={(c) => assignCustomer(item.id, c)} onCancel={() => setPicking('')} />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button disabled={busy === item.id} onClick={() => changeStatus(item.id, '已確認')} className="flex min-h-9 items-center gap-1 rounded-full bg-brand-500 px-3 text-xs font-semibold text-white active:scale-95 disabled:opacity-50"><Check className="size-3.5" />確認</button>
                      <button disabled={busy === item.id} onClick={() => changeStatus(item.id, '駁回')} className="flex min-h-9 items-center gap-1 rounded-full bg-stone-100 px-3 text-xs font-semibold text-stone-600 active:scale-95 disabled:opacity-50"><X className="size-3.5" />駁回</button>
                    </div>
                    </div>
                    <label className="mt-2 block text-[11px] font-semibold text-stone-500">
                      項目判定{item.autoClassified ? '（系統依回報內容判定，可更正）' : ''}
                      <select
                        className="select-soft mt-1 block w-full text-xs"
                        value={correction[item.id] ?? item.item}
                        onChange={(e) => setCorrection({ ...correction, [item.id]: e.target.value })}
                      >
                        {data.itemOptions.map((o) => <option key={o.name} value={o.name}>{o.name}（+{o.points}）</option>)}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.pendingByMe.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-bold text-stone-700">我提出的（待處理）</p>
              <div className="mt-2 space-y-2">
                {data.pendingByMe.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-stone-50/80 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-stone-800">助攻 {item.helped}｜{item.item} <span className="text-brand-700">+{item.points}</span></p>
                      <p className="mt-0.5 text-xs text-stone-400">{item.customerName || '未指定客戶'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="chip text-[11px]">{item.status}</span>
                      {item.status === '已確認' && (
                        <button disabled={busy === item.id} onClick={() => changeStatus(item.id, '已認列')} className="min-h-9 rounded-full bg-stone-900 px-3 text-xs font-semibold text-white active:scale-95 disabled:opacity-50" title="須由總經理或管理層執行">認列</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-sm font-bold text-stone-700">{data.periodLabel}全體排行</h3>
            {data.ranking.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-stone-50 py-8 text-center text-sm text-stone-400">{data.periodLabel}尚無已認列的協作積分</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-stone-400">
                      <th className="pb-2 pr-3 font-bold">#</th>
                      <th className="pb-2 pr-3 font-bold">業務</th>
                      <th className="pb-2 pr-3 text-right font-bold">積分</th>
                      <th className="pb-2 text-right font-bold">筆數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-900/[0.06]">
                    {data.ranking.map((row, index) => (
                      <tr key={row.name} className={row.name === data.me ? 'bg-brand-50/50' : ''}>
                        <td className="py-2.5 pr-3 tabular-nums text-stone-400">{index + 1}</td>
                        <td className="py-2.5 pr-3 font-semibold text-stone-800">{row.name}</td>
                        <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-brand-700">{row.points}</td>
                        <td className="py-2.5 text-right tabular-nums text-stone-500">{row.entries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-stone-400">
            依《業務客戶分區管理辦法》第八章：助攻者主動提出，經受助業務確認、總經理於業務會議認列後計分。
            同一案件的協作積分原則僅認列一次；累積積分最高者於客戶重新分配時有優先認領權。
          </p>
        </div>
      )}
    </section>
  )
}
