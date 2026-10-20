'use client'

/**
 * VisitClosuresPanel —— 醫事監控「客情回報歇業」
 *
 * 系統每晚從客情偵測業務回報的歇業／停業，已自動寫進客戶「機構狀態」。
 * 這裡列出最近的自動更新，判斷錯了可一鍵復原（改回原值，同一筆客情不再觸發）。
 * 規則見 lib/visit-closures.ts；沒有任何紀錄時整塊不顯示。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Entry = {
  customerId: string; customerName: string; visitDate: string; reporter: string
  from: string; to: string; snippet: string; at: string; undoneAt?: string; undoneBy?: string
}

const md = (iso: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '')

export function VisitClosuresPanel() {
  const [items, setItems] = useState<Entry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/medical-monitor/visit-closures')
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? '讀取失敗'); setItems(j.items ?? []) })
      .catch((e) => { setError(e?.message ?? '讀取失敗'); setItems([]) })
  }, [])

  async function undo(e: Entry) {
    setBusy(e.customerId); setError('')
    try {
      const res = await fetch('/api/admin/medical-monitor/visit-closures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo', customerId: e.customerId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? '復原失敗')
      setItems((prev) => (prev ?? []).map((x) => (x.customerId === e.customerId ? { ...x, ...j.entry } : x)))
    } catch (err: any) {
      setError(err?.message ?? '復原失敗')
    } finally {
      setBusy('')
    }
  }

  if (!items || (items.length === 0 && !error)) return null
  const active = items.filter((i) => !i.undoneAt)
  const recent = active.filter((i) => Date.now() - Date.parse(i.at) < 7 * 86400_000).length

  return (
    <div className="card-soft p-4 sm:p-5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-3 text-left transition-all active:scale-[0.99]">
        <span className={`text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-stone-700">客情回報歇業</span>
          <span className="mt-0.5 block text-xs text-stone-400">業務日報寫明歇業／停業的客戶，系統每晚自動更新機構狀態；判斷錯誤可復原</span>
        </span>
        {recent > 0 && <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">近 7 天 {recent} 家</span>}
        <span className="shrink-0 text-xs text-stone-400 tabular-nums">共 {active.length} 家</span>
      </button>

      {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      {open && (
        <ul className="mt-3 space-y-2">
          {items.map((e) => (
            <li key={e.customerId} className={`rounded-2xl p-3.5 ring-1 ring-stone-900/5 ${e.undoneAt ? 'bg-stone-50/60 opacity-60' : 'bg-stone-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/customers/${e.customerId}`} className="text-sm font-semibold text-stone-800 hover:text-brand-700 hover:underline">{e.customerName}</Link>
                  <p className="mt-0.5 text-xs text-stone-500">
                    機構狀態 {e.from || '空白'} → <b className="font-semibold text-stone-700">{e.to}</b>
                    ・{e.reporter || '業務'} {md(e.visitDate)} 回報・{md(e.at)} 更新
                  </p>
                </div>
                {e.undoneAt
                  ? <span className="shrink-0 text-[11px] text-stone-400">已由 {e.undoneBy} 復原</span>
                  : (
                    <button type="button" onClick={() => undo(e)} disabled={busy === e.customerId}
                      className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-100 active:scale-95 disabled:opacity-50">
                      {busy === e.customerId ? '復原中…' : '復原'}
                    </button>
                  )}
              </div>
              <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-stone-600">「{e.snippet}」</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
