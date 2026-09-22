'use client'

/**
 * components/MyTendersPanel.tsx — 今日工作的標案提醒
 *
 * 只顯示「需要動作」的：我認領且未結案、或我負責客戶的標案，且七天內截止或仍在投標中。
 * 目的是讓業務不必特地切到標案分頁才想起來，而不是把整份清單搬過來。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Row = {
  id: string; title: string; unitName: string; city: string; deadline: string
  budget: number | null; customerId: string; customerSalesperson: string
  status: string; owner: string
}

const daysLeft = (deadline: string) => {
  if (!deadline) return null
  const d = new Date(deadline.replace(/\//g, '-').slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400_000)
}

export default function MyTendersPanel({ currentUser = '' }: { currentUser?: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/bd/tenders')
        const data = await res.json()
        if (res.ok) setRows(data.records ?? [])
      } catch { /* 靜默：標案失敗不影響今日工作 */ }
      finally { setLoaded(true) }
    })()
  }, [])

  const mine = rows.filter((r) => {
    const isMine = r.owner === currentUser || (r.customerSalesperson === currentUser && !!r.customerId)
    if (!isMine) return false
    if (['得標', '未得標', '放棄'].includes(r.status)) return false
    const d = daysLeft(r.deadline)
    return r.status === '投標中' || r.status === '已投標' || (d !== null && d >= 0 && d <= 7)
  }).sort((a, b) => (daysLeft(a.deadline) ?? 99) - (daysLeft(b.deadline) ?? 99))

  if (!loaded || mine.length === 0) return null

  return (
    <div className="card-soft p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-stone-800">🏛️ 我的標案</h3>
        <span className="text-xs text-stone-400">{mine.length} 件需要注意</span>
        <Link href="/bd?tab=tender" className="ml-auto text-xs text-brand-700 hover:text-brand-800">全部標案 →</Link>
      </div>
      <ul className="mt-2 space-y-1.5">
        {mine.slice(0, 5).map((r) => {
          const d = daysLeft(r.deadline)
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {r.status && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{r.status}</span>}
              <span className="font-medium text-stone-700">{r.title}</span>
              <span className="text-stone-400">{r.unitName}</span>
              {d !== null && (
                <span className={d <= 3 ? 'font-semibold text-red-600' : 'text-amber-700'}>
                  {d === 0 ? '今天截止' : `剩 ${d} 天`}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
