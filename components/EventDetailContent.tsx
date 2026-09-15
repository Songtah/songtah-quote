'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Link from 'next/link'
import type { EventItem, EventRegistration as BaseRegistration } from '@/lib/notion/events'
import type { CourseCost } from '@/lib/system-notion'
import { EventRegistrationPageSettings } from '@/components/EventRegistrationPageSettings'
import { RegistrationCustomerCell } from '@/components/RegistrationCustomerCell'

type EventRegistration = BaseRegistration & { customerName?: string; customerArea?: string }

const PAY_STYLE: Record<string, string> = {
  '未付款': 'bg-amber-50 text-amber-700',
  '已付款': 'bg-emerald-50 text-emerald-700',
  '已退款': 'bg-stone-100 text-stone-500',
}

const STATUS_STYLE: Record<string, string> = {
  '已報名': 'bg-blue-100 text-blue-700',
  '已確認': 'bg-brand-50 text-green-700',
  '已到場': 'bg-emerald-50 text-emerald-700',
  '取消':   'bg-red-100 text-red-600',
}

const EVENT_STATUS_STYLE: Record<string, string> = {
  '籌備中': 'bg-stone-100 text-stone-600',
  '開放報名': 'bg-brand-50 text-green-700',
  '已結束': 'bg-red-100 text-red-600',
}

const TYPE_STYLE: Record<string, string> = {
  '研討會': 'bg-blue-50 text-blue-700',
  '產品發表': 'bg-purple-50 text-purple-700',
  '培訓': 'bg-brand-50 text-emerald-700',
  '展覽': 'bg-orange-50 text-orange-700',
  '其他': 'bg-stone-50 text-stone-600',
}

export function EventDetailContent({ id }: { id: string }) {
  const [event, setEvent]           = useState<EventItem | null>(null)
  const [regs, setRegs]             = useState<EventRegistration[]>([])
  const [loading, setLoading]       = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [courseCost, setCourseCost] = useState<CourseCost | null>(null)
  const [checkin, setCheckin]       = useState<{ url: string; open: boolean; qr: string } | null>(null)
  const [checkinError, setCheckinError] = useState('')
  const [copied, setCopied]         = useState(false)
  const [matching, setMatching]     = useState(false)
  const [matchResult, setMatchResult] = useState('')

  const loadRegs = useCallback(() =>
    fetch(`/api/events/${id}?registrations=1`).then(r => r.json())
      .then((list) => setRegs(Array.isArray(list) ? list : [])), [id])

  async function showCheckinQr() {
    setCheckinError('')
    try {
      const res = await fetch(`/api/events/${id}?checkin=1`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '無法產生簽到連結')
      const qr = await QRCode.toDataURL(json.url, { width: 480, margin: 1 })
      setCheckin({ url: json.url, open: json.open, qr })
    } catch (e: any) {
      setCheckinError(e?.message ?? '無法產生簽到連結')
    }
  }

  async function rematch() {
    setMatching(true); setMatchResult('')
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _type: 'process-registrations' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '配對失敗')
      setMatchResult(`新配對 ${json.customerMatched} 筆、依衛福部名單新建客戶 ${json.customerCreated ?? 0} 筆、仍未配對 ${json.unmatched} 筆`)
      await loadRegs()
    } catch (e: any) {
      setMatchResult(e?.message ?? '配對失敗')
    } finally {
      setMatching(false)
    }
  }

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

  async function changePayment(regId: string, paymentStatus: string) {
    setUpdatingId(regId)
    const res = await fetch(`/api/events/${regId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'registration-payment', paymentStatus }),
    })
    if (res.ok) setRegs(prev => prev.map(r => r.id === regId ? { ...r, paymentStatus } : r))
    setUpdatingId(null)
  }

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
    return <div className="card-soft py-16 text-center text-stone-400">載入中…</div>
  }

  if (!event) {
    return <div className="card-soft py-16 text-center text-stone-400">找不到活動</div>
  }

  const showPayment = event.paid || regs.some(r => r.paymentStatus && r.paymentStatus !== '免費')
  const seatsTaken = regs.filter(r => r.status !== '取消').reduce((sum, r) => sum + (r.attendees || 1), 0)
  const totalAttendees = regs.reduce((sum, r) => sum + (r.attendees || 0), 0)
  const confirmed = regs.filter(r => r.status === '已確認' || r.status === '已到場')
  const pending   = regs.filter(r => r.status === '已報名')
  const cancelled = regs.filter(r => r.status === '取消')

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/events" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-stone-500 transition-all hover:bg-white hover:text-brand-600 active:scale-95">
        ← 返回活動列表
      </Link>

      {/* Event info card */}
      <div className="card-soft p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex gap-2 flex-wrap">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TYPE_STYLE[event.type] ?? 'bg-stone-50 text-stone-600'}`}>
              {event.type || '未分類'}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${EVENT_STATUS_STYLE[event.status] ?? 'bg-stone-100 text-stone-600'}`}>
              {event.status}
            </span>
          </div>
        </div>

        <h2 className="mb-4 text-xl font-bold text-stone-800">{event.name}</h2>

        <div className="grid gap-3 text-sm text-stone-600 sm:grid-cols-2">
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
          <p className="mt-4 text-sm text-stone-500 border-t border-stone-100 pt-4">
            {event.description}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '報名總數', value: regs.length, color: 'text-stone-900' },
          { label: '已確認／到場', value: confirmed.length, color: 'text-green-600' },
          { label: '待確認', value: pending.length, color: 'text-blue-600' },
          { label: '預計出席人數', value: totalAttendees, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="card-soft p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-stone-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 關聯課程成本試算 */}
      {courseCost && (
        <div className="card-soft p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-stone-900">💰 課程成本試算</h3>
            <Link href="/course-costs" className="text-xs text-brand-600 hover:underline">查看明細 →</Link>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-stone-400">總成本</p><p className="font-semibold text-red-600">${courseCost.totalCost.toLocaleString()}</p></div>
            <div><p className="text-xs text-stone-400">總收入</p><p className="font-semibold text-blue-600">${courseCost.totalRevenue.toLocaleString()}</p></div>
            <div>
              <p className="text-xs text-stone-400">淨利</p>
              <p className={`font-semibold ${courseCost.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${courseCost.netProfit.toLocaleString()}{courseCost.marginPct ? ` (${courseCost.marginPct.toFixed(1)}%)` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      <EventRegistrationPageSettings
        event={event}
        seatsTaken={seatsTaken}
        onSaved={(patch) => setEvent(prev => prev ? { ...prev, ...patch } : prev)}
      />

      {/* 客戶足跡：展會簽到 QR ＋ 自動配對說明 */}
      <div className="card-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-stone-900">客戶足跡</h3>
            <p className="mt-1 text-sm leading-6 text-stone-500">
              課程報名（外掛表單）與展會簽到都寫進這份名單，系統每小時自動配對客戶，
              配對到的客戶會出現在負責業務的拜訪建議，不需要人工轉交。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={showCheckinQr}
              className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-brand-600 active:scale-95">
              展會簽到 QR code
            </button>
            <button onClick={rematch} disabled={matching}
              className="rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-40">
              {matching ? '配對中…' : '立即重新配對'}
            </button>
          </div>
        </div>
        {matchResult && <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-2.5 text-sm text-stone-600">{matchResult}</p>}
        {checkinError && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{checkinError}</p>}
        {checkin && (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl bg-cream-50 p-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkin.qr} alt="展會簽到 QR code" className="size-44 rounded-xl bg-white p-2 ring-1 ring-stone-900/5" />
            <div className="min-w-0 flex-1 text-sm">
              <p className={checkin.open ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                {checkin.open ? '目前開放簽到' : '尚未開放：活動日前 1 天至結束後 1 天可簽到'}
              </p>
              <p className="mt-1 break-all text-xs text-stone-500">{checkin.url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => { navigator.clipboard.writeText(checkin.url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-50 active:scale-95">
                  {copied ? '已複製' : '複製連結'}
                </button>
                <a href={checkin.qr} download={`簽到QR-${event.name}.png`}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-50 active:scale-95">
                  下載 QR 圖檔
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Registrations table */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="font-semibold text-stone-900">報名名單</h3>
          <span className="text-sm text-stone-400">{regs.length} 筆</span>
        </div>

        {regs.length === 0 ? (
          <div className="py-12 text-center text-stone-400 text-sm">尚無報名紀錄</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-xs text-stone-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">機構名稱</th>
                  <th className="px-4 py-3 text-left font-medium">客戶配對</th>
                  <th className="px-4 py-3 text-left font-medium">聯絡人</th>
                  <th className="px-4 py-3 text-left font-medium">電話</th>
                  <th className="px-4 py-3 text-left font-medium">信箱</th>
                  <th className="px-4 py-3 text-center font-medium">人數</th>
                  {showPayment && <th className="px-4 py-3 text-left font-medium">付款</th>}
                  <th className="px-4 py-3 text-left font-medium">狀態</th>
                  <th className="px-4 py-3 text-left font-medium">報名時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-900/[0.06]">
                {regs.map(reg => (
                  <tr key={reg.id} className="align-top transition-colors hover:bg-brand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-900">{reg.institution}</p>
                      {(reg.city || reg.unitType) && <p className="text-[11px] text-stone-400">{[`${reg.city}${reg.district}`, reg.unitType].filter(Boolean).join('・')}</p>}
                      {reg.source && <p className="text-[11px] text-stone-400">來源：{reg.source}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <RegistrationCustomerCell
                        registrationId={reg.id}
                        institution={reg.institution}
                        value={{ customerId: reg.customerId, customerName: reg.customerName ?? '', customerArea: reg.customerArea ?? '', matchNote: reg.matchNote }}
                        onChange={(v) => setRegs(prev => prev.map(r => r.id === reg.id ? { ...r, ...v } : r))}
                      />
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {reg.contact || '—'}
                      {reg.jobTitle && <p className="text-[11px] text-stone-400">{reg.jobTitle}</p>}
                    </td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{reg.phone || '—'}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {reg.email
                        ? <a href={`mailto:${reg.email}`} className="text-brand-600 hover:underline">{reg.email}</a>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-stone-900">{reg.attendees || 1}</td>
                    {showPayment && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        {reg.amount > 0 && <p className="text-xs font-semibold text-stone-700">NT$ {reg.amount.toLocaleString('zh-TW')}</p>}
                        {reg.paymentStatus && reg.paymentStatus !== '免費' ? (
                          <select
                            className={`mt-0.5 rounded-full border-0 px-2 py-0.5 text-xs font-medium ${PAY_STYLE[reg.paymentStatus] ?? 'bg-stone-100 text-stone-600'}`}
                            value={reg.paymentStatus}
                            disabled={updatingId === reg.id}
                            onChange={e => changePayment(reg.id, e.target.value)}
                          >
                            {['未付款', '已付款', '已退款'].map(s => <option key={s}>{s}</option>)}
                          </select>
                        ) : <span className="text-xs text-stone-400">{reg.paymentStatus || '—'}</span>}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <select
                        className={`rounded-full px-2 py-0.5 text-xs font-medium border-0 cursor-pointer ${STATUS_STYLE[reg.status] ?? 'bg-stone-100 text-stone-600'}`}
                        value={reg.status}
                        disabled={updatingId === reg.id}
                        onChange={e => changeStatus(reg.id, e.target.value)}
                      >
                        <option value="已報名">已報名</option>
                        <option value="已確認">已確認</option>
                        <option value="已到場">已到場</option>
                        <option value="取消">取消</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                      {reg.registeredAt ? new Date(reg.registeredAt).toLocaleDateString('zh-TW') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cancelled.length > 0 && (
          <div className="px-5 py-3 border-t border-stone-100 text-xs text-stone-400">
            另有 {cancelled.length} 筆已取消報名未顯示於統計
          </div>
        )}
      </div>
    </div>
  )
}
