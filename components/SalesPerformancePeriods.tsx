'use client'

/**
 * 業務個人業績：週／月／季／年 統計總數 ＋ 訂單明細。
 * 資料來自 /api/dashboard/my-performance/period，只含呼叫者本人的數字。
 */
import { useCallback, useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type Period = 'week' | 'month' | 'quarter' | 'year'

const TABS: { value: Period; label: string }[] = [
  { value: 'week', label: '本週' },
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '本季' },
  { value: 'year', label: '今年' },
]

type PeriodData = {
  scope: 'self' | 'team'
  salesperson: string
  bySalesperson: { name: string; amount: number; orders: number; visits: number }[]
  salespeople: string[]
  period: Period
  periodLabel: string
  previousLabel: string
  range: { from: string; to: string; label: string }
  summary: { amount: number; orders: number; visits: number; averageOrderAmount: number }
  previous: { amount: number; orders: number; visits: number }
  growth: { amountPct: number | null; amountDelta: number; ordersDelta: number; visitsDelta: number }
  byStatus: Record<string, { orders: number; amount: number }>
  items: { date: string; customerName: string; status: string; amount: number; orderNumber: string }[]
  itemsTruncated: boolean
}

const money = (n: number) => `NT$ ${n.toLocaleString()}`

function DeltaBadge({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400">
        <Minus className="size-3" />持平
      </span>
    )
  }
  const up = value > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon className="size-3" />{up ? '+' : ''}{value.toLocaleString()}{suffix}
    </span>
  )
}

/** 管理帳號用：'' = 全部業務（後端預設），其餘為指定業務姓名 */
const ALL = ''

export function SalesPerformancePeriods() {
  const [period, setPeriod] = useState<Period>('month')
  const [who, setWho] = useState<string>(ALL)
  const [data, setData] = useState<PeriodData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 切換業務時下拉選單不能跟著清空，所以選項獨立保存
  const [people, setPeople] = useState<string[]>([])

  const load = useCallback((nextPeriod: Period, nextWho: string, signal: AbortSignal) => {
    setLoading(true)
    setError('')
    const query = new URLSearchParams({ period: nextPeriod })
    if (nextWho) query.set('salesperson', nextWho)
    fetch(`/api/dashboard/my-performance/period?${query}`, { signal })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || '讀取業績失敗')
        setData(json)
        if (json.salespeople?.length) setPeople(json.salespeople)
      })
      .catch((caught: any) => { if (caught?.name !== 'AbortError') setError(caught.message) })
      .finally(() => { if (!signal.aborted) setLoading(false) })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(period, who, controller.signal)
    return () => controller.abort()
  }, [period, who, load])

  // 只有管理帳號的第一次回應會帶 salespeople，據此決定要不要顯示選單
  const canPickPerson = people.length > 0

  return (
    <section className="card-soft overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6 sm:px-7">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
            {data?.scope === 'team' ? 'TEAM PERFORMANCE' : 'MY PERFORMANCE'}
          </p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">
            業績狀況
            {data && <span className="ml-2 text-sm font-semibold text-brand-700">{data.salesperson}</span>}
          </h2>
        </div>
        {data && <p className="text-xs text-stone-400">{data.range.label}・{data.range.from} ~ {data.range.to}</p>}
      </div>

      {canPickPerson && (
        <div className="px-6 pt-4 sm:px-7">
          <label className="text-xs font-semibold text-stone-500">
            查看對象
            <select
              className="select-soft mt-1.5 block w-full max-w-56"
              value={who}
              onChange={(event) => setWho(event.target.value)}
            >
              <option value={ALL}>全部業務（合計）</option>
              {people.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto px-6 pt-4 sm:px-7">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setPeriod(tab.value)}
            aria-current={period === tab.value ? 'true' : undefined}
            className={`min-w-max rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
              period === tab.value ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="px-6 py-10 text-center text-sm text-stone-400 sm:px-7">正在統計業績…</p>}
      {error && <p className="mx-6 my-5 rounded-2xl bg-red-50 p-4 text-sm text-red-600 sm:mx-7">{error}</p>}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 gap-3 px-6 pt-5 sm:px-7 lg:grid-cols-4">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">業績金額</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{money(data.summary.amount)}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <DeltaBadge value={data.growth.amountDelta} />
                {data.growth.amountPct !== null && <span className="text-xs text-stone-400">({data.growth.amountPct > 0 ? '+' : ''}{data.growth.amountPct}%)</span>}
              </div>
              <p className="mt-1 text-[11px] text-stone-400">{data.previousLabel} {money(data.previous.amount)}</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">訂單數</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{data.summary.orders.toLocaleString()}</p>
              <div className="mt-1.5"><DeltaBadge value={data.growth.ordersDelta} suffix=" 筆" /></div>
              <p className="mt-1 text-[11px] text-stone-400">{data.previousLabel} {data.previous.orders} 筆</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">平均客單價</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{money(data.summary.averageOrderAmount)}</p>
              <p className="mt-1.5 text-[11px] text-stone-400">依本期成立訂單計算</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs text-stone-500">拜訪次數</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{data.summary.visits.toLocaleString()}</p>
              <div className="mt-1.5"><DeltaBadge value={data.growth.visitsDelta} suffix=" 次" /></div>
              <p className="mt-1 text-[11px] text-stone-400">{data.previousLabel} {data.previous.visits} 次</p>
            </div>
          </div>

          {Object.keys(data.byStatus).length > 0 && (
            <div className="flex flex-wrap gap-2 px-6 pt-4 sm:px-7">
              {Object.entries(data.byStatus).map(([status, value]) => (
                <span key={status} className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
                  {status} {value.orders} 筆・{money(value.amount)}
                </span>
              ))}
            </div>
          )}

          {data.scope === 'team' && data.bySalesperson.length > 0 && (
            <div className="px-6 pt-5 sm:px-7">
              <h3 className="text-sm font-bold text-stone-700">各業務{data.periodLabel}表現</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-stone-400">
                      <th className="pb-2 pr-3 font-bold">#</th>
                      <th className="pb-2 pr-3 font-bold">業務</th>
                      <th className="pb-2 pr-3 text-right font-bold">業績金額</th>
                      <th className="pb-2 pr-3 text-right font-bold">訂單</th>
                      <th className="pb-2 text-right font-bold">拜訪</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-900/[0.06]">
                    {data.bySalesperson.map((row, index) => (
                      <tr key={row.name}>
                        <td className="py-2.5 pr-3 tabular-nums text-stone-400">{index + 1}</td>
                        <td className="py-2.5 pr-3">
                          <button
                            onClick={() => setWho(row.name)}
                            className="font-semibold text-brand-700 transition-colors hover:text-brand-800 hover:underline"
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-stone-900">{money(row.amount)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-stone-500">{row.orders.toLocaleString()}</td>
                        <td className="py-2.5 text-right tabular-nums text-stone-500">{row.visits.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-stone-400">點業務姓名可切換為單人檢視。</p>
            </div>
          )}

          <div className="px-6 py-5 sm:px-7">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-700">訂單明細</h3>
              <p className="text-xs text-stone-400">{data.summary.orders.toLocaleString()} 筆{data.itemsTruncated ? '（顯示最新 200 筆）' : ''}</p>
            </div>
            {data.items.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-stone-50 py-8 text-center text-sm text-stone-400">
                {data.periodLabel}尚無成立的訂單
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-stone-400">
                      <th className="pb-2 pr-3 font-bold">日期</th>
                      <th className="pb-2 pr-3 font-bold">客戶</th>
                      <th className="pb-2 pr-3 font-bold">訂單編號</th>
                      <th className="pb-2 pr-3 font-bold">狀態</th>
                      <th className="pb-2 text-right font-bold">金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-900/[0.06]">
                    {data.items.map((item, index) => (
                      <tr key={`${item.orderNumber}-${index}`}>
                        <td className="py-2.5 pr-3 tabular-nums text-stone-500">{item.date}</td>
                        <td className="py-2.5 pr-3 font-medium text-stone-800">{item.customerName || '（未填客戶）'}</td>
                        <td className="py-2.5 pr-3 tabular-nums text-stone-400">{item.orderNumber || '—'}</td>
                        <td className="py-2.5 pr-3"><span className="chip text-[11px]">{item.status}</span></td>
                        <td className="py-2.5 text-right font-semibold tabular-nums text-stone-900">{money(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
