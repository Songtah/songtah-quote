'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Ticket } from '@/types'
import { TICKET_SLA_DAYS } from '@/lib/ticket-validation'

const STATUS_STYLES: Record<string, string> = {
  '尚未處理':      'bg-orange-100 text-orange-700 border-orange-200',
  '🔧 維修中':     'bg-blue-100 text-blue-700 border-blue-200',
  '👌 已受理':     'bg-blue-100 text-blue-700 border-blue-200',
  '🔍 診斷問題中': 'bg-sky-100 text-sky-700 border-sky-200',
  '⚙️ 測試中':     'bg-indigo-100 text-indigo-700 border-indigo-200',
  '🔍 後續追蹤':   'bg-purple-100 text-purple-700 border-purple-200',
  '✅ 結案':       'bg-green-100 text-green-700 border-green-200',
}

const PRIORITY_STYLES: Record<string, string> = {
  '高':   'bg-red-100 text-red-700',
  '中':   'bg-yellow-100 text-yellow-700',
  '低':   'bg-slate-100 text-slate-400',
  '緊急': 'bg-red-200 text-red-800',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(d?: string) {
  if (!d) return ''
  return d.slice(0, 10).replace(/-/g, '/')
}

// 逾期視覺提醒：超過 SLA 天數視為逾期、到期當天視為即將逾期，不擋任何操作。
function slaBadge(ticket: Ticket): { label: string; cls: string } | null {
  if (!ticket.priority || !ticket.createdDate || ticket.status === '✅ 結案') return null
  const slaDays = TICKET_SLA_DAYS[ticket.priority]
  if (!slaDays) return null
  const created = new Date(ticket.createdDate)
  if (Number.isNaN(created.getTime())) return null
  const daysElapsed = Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000))
  if (daysElapsed > slaDays) return { label: `⏰ 逾期 ${daysElapsed - slaDays} 天`, cls: 'bg-red-100 text-red-700 border-red-200' }
  if (daysElapsed === slaDays) return { label: '⏰ 即將逾期', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
  return null
}

const ALL = '全部'

export default function TicketList({ tickets }: { tickets: Ticket[] }) {
  // Collect unique statuses in the order they appear
  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const t of tickets) {
      if (t.status && !seen.has(t.status)) { seen.add(t.status); list.push(t.status) }
    }
    return list
  }, [tickets])

  const [filterStatus, setFilterStatus] = useState(ALL)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const displayed = useMemo(() => {
    let list = filterStatus === ALL ? tickets : tickets.filter((t) => t.status === filterStatus)
    // tickets already sorted desc by API; reverse for asc
    if (sortDir === 'asc') list = [...list].reverse()
    return list
  }, [tickets, filterStatus, sortDir])

  return (
    <section className="panel p-6">
      {/* Header + controls */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-slate-900">案件列表</h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {displayed.length} / {tickets.length} 筆
          </span>
        </div>

        {/* Sort toggle */}
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition"
        >
          <span>{sortDir === 'desc' ? '↓' : '↑'}</span>
          <span>{sortDir === 'desc' ? '由新到舊' : '由舊到新'}</span>
        </button>
      </div>

      {/* Status filter pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[ALL, ...statusOptions].map((s) => {
          const active = filterStatus === s
          const baseCls = active
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${baseCls}`}
            >
              {s}
              {s !== ALL && (
                <span className={`ml-1.5 ${active ? 'text-emerald-200' : 'text-slate-400'}`}>
                  {tickets.filter((t) => t.status === s).length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {displayed.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-400 text-center">
          沒有符合條件的案件
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/tickets/${ticket.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-[#fbfcfb] to-[#f6f8f6] px-5 py-4 transition hover:border-emerald-200 hover:bg-white hover:shadow-sm group"
            >
              {/* Left */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-slate-700 font-mono shrink-0">
                    {ticket.number || '—'}
                  </span>
                  {ticket.priority && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_STYLES[ticket.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                      {ticket.priority}
                    </span>
                  )}
                </div>
                <div className="font-medium text-slate-800 truncate group-hover:text-emerald-800 transition-colors">
                  {ticket.customerName}
                  {ticket.title && ticket.title !== ticket.customerName && (
                    <span className="text-slate-400 font-normal ml-2 text-sm">— {ticket.title}</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-400 flex flex-wrap gap-x-3">
                  {ticket.createdDate && (
                    <span className="text-slate-400">{formatDate(ticket.createdDate)}</span>
                  )}
                  {ticket.ticketType && <span>{ticket.ticketType}</span>}
                  {ticket.supportOwner && <span>{ticket.supportOwner}</span>}
                </div>
              </div>

              {/* Right */}
              <div className="flex items-center gap-3 shrink-0">
                {(() => {
                  const sla = slaBadge(ticket)
                  return sla ? (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${sla.cls}`}>
                      {sla.label}
                    </span>
                  ) : null
                })()}
                {ticket.status && <StatusBadge status={ticket.status} />}
                <span className="text-slate-300 group-hover:text-emerald-400 transition-colors text-sm">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
