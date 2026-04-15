'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import type { Ticket } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  '尚未處理':     'bg-orange-100 text-orange-700 border border-orange-200',
  '🔧 維修中':    'bg-blue-100 text-blue-700 border border-blue-200',
  '👌 已受理':    'bg-blue-100 text-blue-700 border border-blue-200',
  '🔍 診斷問題中': 'bg-sky-100 text-sky-700 border border-sky-200',
  '⚙️ 測試中':    'bg-indigo-100 text-indigo-700 border border-indigo-200',
  '🔍 後續追蹤':  'bg-purple-100 text-purple-700 border border-purple-200',
  '✅ 結案':      'bg-green-100 text-green-700 border border-green-200',
}

const PRIORITY_STYLES: Record<string, string> = {
  '高':   'bg-red-100 text-red-700',
  '中':   'bg-yellow-100 text-yellow-700',
  '低':   'bg-slate-100 text-slate-500',
  '緊急': 'bg-red-200 text-red-800 font-semibold',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${cls}`}>{status}</span>
}

function formatDate(d?: string) {
  if (!d) return ''
  return d.slice(0, 10).replace(/-/g, '/')
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-800 font-medium text-sm">{value}</dd>
    </div>
  )
}

function TextBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <h3 className="font-semibold text-gray-700 text-sm mb-2">{label}</h3>
      <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  )
}

export default function TicketDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/tickets/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setTicket(d)
      })
      .catch(() => setError('無法載入案件資料'))
      .finally(() => setLoading(false))
  }, [params.id])

  const pageTitle = ticket ? (ticket.customerName || ticket.title || '案件詳情') : '案件詳情'
  const pageDesc = ticket?.number ? `${ticket.number}・技術支援案件` : '技術支援案件詳細資訊'

  return (
    <AppShell title={pageTitle} description={pageDesc}>
      <div className="mb-4">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 返回
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 h-32 animate-pulse" />
          ))}
        </div>
      )}

      {error && <div className="bg-white rounded-2xl border border-red-200 p-6 text-sm text-red-600">{error}</div>}

      {ticket && (
        <div className="space-y-5">
          {/* Header card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-2xl font-black text-slate-900">{ticket.number || '—'}</span>
                  {ticket.priority && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ticket.priority}
                    </span>
                  )}
                </div>
                <p className="text-slate-600 text-sm">{ticket.title || ticket.customerName || '—'}</p>
              </div>
              <StatusBadge status={ticket.status} />
            </div>
          </div>

          {/* 基本資訊 */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-semibold text-gray-800 mb-4">基本資訊</h2>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Field label="客戶單位" value={ticket.customerName || '—'} />
              <Field label="案件類型" value={ticket.ticketType} />
              <Field label="生產商" value={ticket.manufacturer} />
              <Field label="聯絡人" value={ticket.contactName} />
              <Field label="技術支援對口" value={ticket.supportOwner} />
              <Field label="業務窗口" value={ticket.salesOwner} />
              <Field label="預計維修日期" value={formatDate(ticket.scheduledDate)} />
              <Field label="建立日期" value={formatDate(ticket.createdDate)} />
            </dl>
          </div>

          {/* 情境描述 */}
          <TextBlock label="情境描述" value={ticket.description} />

          {/* 原因 */}
          <TextBlock label="原因分析" value={ticket.cause} />

          {/* 解決方案 */}
          <TextBlock label="解決方案" value={ticket.solution} />

          {/* 備註 */}
          <TextBlock label="備註" value={ticket.note} />
        </div>
      )}
    </AppShell>
  )
}
