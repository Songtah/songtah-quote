'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { EventItem, EventRegistration, CourseCost } from '@/lib/system-notion'

const STATUS_STYLE: Record<string, string> = {
  '已報名': 'bg-blue-100 text-blue-700',
  '已確認': 'bg-green-100 text-green-700',
  '取消':   'bg-red-100 text-red-600',
}

const EVENT_STATUS_STYLE: Record<string, string> = {
  '籌備中': 'bg-gray-100 text-gray-600',
  '開放報名': 'bg-green-100 text-green-700',
  '已結束': 'bg-red-100 text-red-600',
}

const TYPE_STYLE: Record<string, string> = {
  '研討會': 'bg-blue-50 text-blue-700',
  '產品發表': 'bg-purple-50 text-purple-700',
  '培訓': 'bg-emerald-50 text-emerald-700',
  '展覽': 'bg-orange-50 text-orange-700',
  '其他': 'bg-gray-50 text-gray-600',
}

export function EventDetailContent({ id }: { id: string }) {
  const [event, setEvent]           = useState<EventItem | null>(null)
  const [regs, setRegs]             = useState<EventRegistration[]>([])
  const [loading, setLoading]       = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [courseCost, setCourseCost] = useState<CourseCost | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/events/${id}`).then(r => r.json()),
      fetch(`/api/events/${id}?registrations=1`).then(r => r.json()),
    ]).then(([ev, regList]) => {
      setEvent(ev)
      setRegs(Array.isArray(regList) ? regList : [])
      setLoading(false)
    }).catch(() => setLoading(false))

    fetch('/api/course-costs').then(r => r.json())
      .then((all) => { if (Array.isArray(all)) setCourseCost(all.find((c: CourseCost) => c.eventId === id) ?? null) })
      .catch(() => {})
  }, [id])

  async function changeStatus(regId: string, status: string) {
    setUpdatingId(regId)
    await fetch(`/api/events/${regId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'registration', status }),
    })
    setRegs(prev => prev.map(r => r.id === regId ? { ...r, status } : r))
    setUpdatingId(null)
  }

  if (loading) {
    return <div className="py-16 text-center text-gray-400">載入中…</div>
  }

  if (!event) {
    return <div className="py-16 text-center text-gray-400">找不到活動</div>
  }

  const totalAttendees = regs.reduce((sum, r) => sum + (r.attendees || 0), 0)
  const confirmed = regs.filter(r => r.status === '已確認')
  const pending   = regs.filter(r => r.status === '已報名')
  const cancelled = regs.filter(r => r.status === '取消')

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        ← 返回活動列表
      </Link>

      {/* Event info card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex gap-2 flex-wrap">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TYPE_STYLE[event.type] ?? 'bg-gray-50 text-gray-600'}`}>
              {event.type || '未分類'}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${EVENT_STATUS_STYLE[event.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {event.status}
            </span>
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-4">{event.name}</h2>

        <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span>📅</span>
            <span>
              {event.date}
              {event.endDate && event.endDate !== event.date ? ` — ${event.endDate}` : ''}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <span>📍</span>
              <span>{event.location}</span>
            </div>
          )}
          {event.deadline && (
            <div className="flex items-center gap-2">
              <span>⏰</span>
              <span>報名截止：{event.deadline}</span>
            </div>
          )}
        </div>

        {event.description && (
          <p className="mt-4 text-sm text-gray-500 border-t border-gray-100 pt-4">
            {event.description}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '報名總數', value: regs.length, color: 'text-gray-900' },
          { label: '已確認', value: confirmed.length, color: 'text-green-600' },
          { label: '待確認', value: pending.length, color: 'text-blue-600' },
          { label: '預計出席人數', value: totalAttendees, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 關聯課程成本試算 */}
      {courseCost && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">💰 課程成本試算</h3>
            <Link href="/course-costs" className="text-xs text-brand-600 hover:underline">查看明細 →</Link>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-gray-400">總成本</p><p className="font-semibold text-red-600">${courseCost.totalCost.toLocaleString()}</p></div>
            <div><p className="text-xs text-gray-400">總收入</p><p className="font-semibold text-blue-600">${courseCost.totalRevenue.toLocaleString()}</p></div>
            <div>
              <p className="text-xs text-gray-400">淨利</p>
              <p className={`font-semibold ${courseCost.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${courseCost.netProfit.toLocaleString()}{courseCost.marginPct ? ` (${courseCost.marginPct.toFixed(1)}%)` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Registrations table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">報名名單</h3>
          <span className="text-sm text-gray-400">{regs.length} 筆</span>
        </div>

        {regs.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">尚無報名紀錄</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">機構名稱</th>
                  <th className="px-4 py-3 text-left font-medium">聯絡人</th>
                  <th className="px-4 py-3 text-left font-medium">信箱</th>
                  <th className="px-4 py-3 text-left font-medium">電話</th>
                  <th className="px-4 py-3 text-center font-medium">人數</th>
                  <th className="px-4 py-3 text-left font-medium">客戶配對</th>
                  <th className="px-4 py-3 text-left font-medium">狀態</th>
                  <th className="px-4 py-3 text-left font-medium">報名時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {regs.map(reg => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{reg.institution}</td>
                    <td className="px-4 py-3 text-gray-600">{reg.contact || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {reg.email
                        ? <a href={`mailto:${reg.email}`} className="text-blue-600 hover:underline">{reg.email}</a>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{reg.phone || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-900">{reg.attendees || 1}</td>
                    <td className="px-4 py-3">
                      {reg.customerId
                        ? <Link href={`/customers/${reg.customerId}`} className="text-blue-600 hover:underline text-xs">查看客戶 →</Link>
                        : <span className="text-gray-300 text-xs">未配對</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 cursor-pointer ${STATUS_STYLE[reg.status] ?? 'bg-gray-100 text-gray-600'}`}
                        value={reg.status}
                        disabled={updatingId === reg.id}
                        onChange={e => changeStatus(reg.id, e.target.value)}
                      >
                        <option value="已報名">已報名</option>
                        <option value="已確認">已確認</option>
                        <option value="取消">取消</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {reg.registeredAt ? new Date(reg.registeredAt).toLocaleDateString('zh-TW') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cancelled.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
            另有 {cancelled.length} 筆已取消報名未顯示於統計
          </div>
        )}
      </div>
    </div>
  )
}
