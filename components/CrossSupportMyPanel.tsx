'use client'

/**
 * 個人頁的跨區支援名單。
 * 依《業務客戶分區管理辦法》第四章顯示 14 日追蹤期限倒數——期限內成交，
 * 設備業績仍歸支援業務，過期則回歸當區業務，所以剩幾天要讓業務一眼看到。
 */
import { useCallback, useEffect, useState } from 'react'
import { Handshake, AlertTriangle } from 'lucide-react'

type Period = 'week' | 'month' | 'quarter' | 'year'

const TABS: { value: Period; label: string }[] = [
  { value: 'week', label: '本週' },
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '本季' },
  { value: 'year', label: '今年' },
]

type Item = {
  id: string
  reportingSalesperson: string
  customerName: string
  customerCity: string
  supportDate: string
  reason: string
  originalSalesperson: string
  status: string
  trackingDaysLeft: number | null
  trackingActive: boolean
}

type Data = {
  scope: 'self' | 'team'
  salesperson: string
  periodLabel: string
  range: { from: string; to: string; label: string }
  total: number
  trackingActive: number
  bySalesperson: Record<string, number>
  items: Item[]
}

export function CrossSupportMyPanel() {
  const [period, setPeriod] = useState<Period>('month')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((next: Period, signal: AbortSignal) => {
    setLoading(true)
    setError('')
    fetch(`/api/dashboard/my-cross-support?period=${next}`, { signal })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || '讀取跨區支援名單失敗')
        setData(json)
      })
      .catch((caught: any) => { if (caught?.name !== 'AbortError') setError(caught.message) })
      .finally(() => { if (!signal.aborted) setLoading(false) })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(period, controller.signal)
    return () => controller.abort()
  }, [period, load])

  return (
    <section className="card-soft overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6 sm:px-7">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">CROSS-TERRITORY SUPPORT</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold text-stone-800">
            <Handshake className="size-4.5 text-brand-600" />跨區支援
            {data && <span className="text-sm font-semibold text-brand-700">{data.salesperson}</span>}
          </h2>
        </div>
        {data && <p className="text-xs text-stone-400">{data.range.label}</p>}
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

      {loading && <p className="px-6 py-10 text-center text-sm text-stone-400 sm:px-7">讀取跨區支援名單…</p>}
      {error && <p className="mx-6 my-5 rounded-2xl bg-red-50 p-4 text-sm text-red-600 sm:mx-7">{error}</p>}

      {!loading && !error && data && (
        <div className="px-6 py-5 sm:px-7">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600">
              {data.periodLabel}支援 {data.total} 件
            </span>
            {data.trackingActive > 0 && (
              <span className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
                {data.trackingActive} 件仍在 14 日追蹤期內
              </span>
            )}
          </div>

          {data.items.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-stone-50 py-8 text-center">
              <p className="text-sm text-stone-500">{data.periodLabel}沒有跨區支援紀錄</p>
              <p className="mt-1 text-xs text-stone-400">在 Slack「業務開發-討論區」用「跨區支援」格式回報後會出現在這裡</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {data.items.map((item) => (
                <article key={item.id} className="rounded-2xl bg-stone-50/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-stone-800">{item.customerName}</h3>
                      <p className="mt-0.5 text-xs text-stone-400">
                        {item.supportDate}
                        {item.customerCity ? `・${item.customerCity}` : ''}
                        {data.scope === 'team' ? `・報備：${item.reportingSalesperson}` : ''}
                      </p>
                    </div>
                    {item.trackingDaysLeft !== null && (
                      item.trackingActive ? (
                        <span className="shrink-0 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-bold text-white">
                          追蹤期剩 {item.trackingDaysLeft} 天
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-200 px-2.5 py-1 text-[11px] font-semibold text-stone-500">
                          <AlertTriangle className="size-3" />已過追蹤期
                        </span>
                      )
                    )}
                  </div>
                  {item.reason && <p className="mt-2 text-sm leading-relaxed text-stone-600">{item.reason}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-stone-500">
                    <span className="rounded-full bg-white px-2.5 py-1">{item.status || '狀態未標示'}</span>
                    {item.originalSalesperson && <span className="rounded-full bg-white px-2.5 py-1">原負責：{item.originalSalesperson}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-stone-400">
            依《業務客戶分區管理辦法》第四章：活動現場或 14 日內成交，設備訂單業績歸支援業務；
            第 15 日起客戶正式回歸當區業務接續服務。耗材、配件與後續服務一律由當區業務認列。
          </p>
        </div>
      )}
    </section>
  )
}
