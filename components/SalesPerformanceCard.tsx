'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'

type MyPerformance = {
  summary: { amount: number; orders: number; visits: number; followUps: number } | null
  rank: number | null
  totalSalespeople: number
  lastMonthAmount: number
  trend: { month: string; label: string; orders: number; amount: number }[]
}

export function SalesPerformanceCard() {
  const [data, setData] = useState<MyPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/dashboard/my-performance').then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取業績失敗')
      setData(json)
    }).catch((caught) => setError(caught.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <section className="card-soft p-6 text-center text-sm text-stone-400">載入業績資料…</section>
  if (error) return <section className="card-soft p-5 text-sm text-red-600">{error}</section>
  if (!data) return null

  const amount = data.summary?.amount ?? 0
  const delta = amount - data.lastMonthAmount
  const deltaPct = data.lastMonthAmount > 0 ? Math.round((delta / data.lastMonthAmount) * 100) : null
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.amount))

  return (
    <section className="card-soft overflow-hidden">
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">本月業績</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-stone-900">NT$ {amount.toLocaleString()}</p>
            {data.lastMonthAmount > 0 && (
              <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                較上月 {delta >= 0 ? '+' : ''}{deltaPct}%
              </p>
            )}
          </div>
          {data.rank && (
            <div className="rounded-2xl bg-brand-50 px-4 py-3 text-center">
              <p className="text-2xl font-bold text-brand-700">{data.rank}<span className="text-sm text-brand-500">/{data.totalSalespeople}</span></p>
              <p className="text-[11px] font-semibold text-brand-500">本月排名</p>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-stone-400">本月訂單數</p>
            <p className="mt-0.5 text-lg font-bold text-stone-800">{data.summary?.orders ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-stone-400">本月拜訪數</p>
            <p className="mt-0.5 text-lg font-bold text-stone-800">{data.summary?.visits ?? 0}</p>
          </div>
        </div>

        {data.trend.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold text-stone-400">近 6 個月走勢</p>
            <div className="flex h-20 items-end gap-2">
              {data.trend.map((t) => (
                <div key={t.month} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className="w-full rounded-t-md bg-brand-200 transition-all"
                    style={{ height: `${Math.max(4, (t.amount / maxTrend) * 100)}%` }}
                  />
                  <span className="text-[10px] text-stone-400">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Link href="/dashboard/performance" className="flex min-h-14 items-center justify-between border-t border-stone-900/[0.06] px-6 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50/50 active:scale-[0.99] sm:px-7">
        <span>查看訂單明細</span><ArrowRight className="size-4" />
      </Link>
    </section>
  )
}
