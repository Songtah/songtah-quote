'use client'

import { useEffect, useState } from 'react'
import { Users2 } from 'lucide-react'

type CrossSupportLog = {
  id: string
  reportingSalesperson: string
  customerName: string
  customerCity: string
  supportDate: string
  reason: string
  originalSalesperson: string
  status: string
}

export function CrossSupportPanel() {
  const [logs, setLogs] = useState<CrossSupportLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterSalesperson, setFilterSalesperson] = useState('')

  useEffect(() => {
    fetch('/api/dashboard/cross-support').then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取失敗')
      setLogs(json.logs ?? [])
    }).catch((caught) => setError(caught.message)).finally(() => setLoading(false))
  }, [])

  const salespeople = Array.from(new Set(logs.map((l) => l.reportingSalesperson))).sort((a, b) => a.localeCompare(b, 'zh-TW'))
  const visible = logs.filter((l) => !filterSalesperson || l.reportingSalesperson === filterSalesperson)

  if (loading) return <section className="card-soft p-6 text-center text-sm text-stone-400">載入跨區支援報備…</section>
  if (error) return <section className="card-soft p-5 text-sm text-red-600">{error}</section>

  return (
    <section className="card-soft overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-stone-900/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Users2 className="size-5" /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">跨區支援報備</p>
            <h2 className="mt-1 text-xl font-bold text-stone-800">{visible.length} 筆</h2>
          </div>
        </div>
        {salespeople.length > 1 && (
          <select className="select-soft w-full sm:w-48" value={filterSalesperson} onChange={(event) => setFilterSalesperson(event.target.value)}>
            <option value="">全部業務</option>
            {salespeople.map((name) => <option key={name}>{name}</option>)}
          </select>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="p-10 text-center text-sm text-stone-400">目前沒有跨區支援報備紀錄。</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-900/[0.06] text-left text-xs text-stone-400">
                <th className="px-5 py-3 font-semibold sm:px-7">業務</th>
                <th className="px-3 py-3 font-semibold">客戶</th>
                <th className="px-3 py-3 font-semibold">日期</th>
                <th className="px-3 py-3 font-semibold">原負責業務</th>
                <th className="px-3 py-3 font-semibold">事由</th>
                <th className="px-3 py-3 font-semibold">狀態</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((log) => (
                <tr key={log.id} className="border-b border-stone-900/[0.05] last:border-0">
                  <td className="px-5 py-3 font-semibold text-stone-800 sm:px-7">{log.reportingSalesperson}</td>
                  <td className="px-3 py-3 text-stone-600">{log.customerName || '（待確認）'}{log.customerCity && <span className="ml-1 text-xs text-stone-400">・{log.customerCity}</span>}</td>
                  <td className="px-3 py-3 text-stone-500">{log.supportDate}</td>
                  <td className="px-3 py-3 text-stone-500">{log.originalSalesperson || '—'}</td>
                  <td className="max-w-xs truncate px-3 py-3 text-stone-500">{log.reason}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${log.status === '待確認' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{log.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
