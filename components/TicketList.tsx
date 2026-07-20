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
  '✅ 結案':       'bg-brand-50 text-green-700 border-brand-200',
}

const PRIORITY_STYLES: Record<string, string> = {
  '高':   'bg-red-100 text-red-700',
  '中':   'bg-yellow-100 text-yellow-700',
  '低':   'bg-slate-100 text-slate-400',
  '緊急': 'bg-red-200 text-red-800',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-stone-100 text-stone-500 border-stone-200'
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
    <section className="card-soft p-4 sm:p-6">
      {/* Header + controls */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-stone-800">下一步：選一筆案件處理</h3>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500">
            {displayed.length} / {tickets.length} 筆
          </span>
        </div>

        {/* Sort toggle */}
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex min-h-10 items-center gap-1.5 rounded-full border border-stone-200 px-4 py-2 text-xs text-stone-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:scale-95 transition-all"
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
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-stone-200 text-stone-500 hover:border-brand-300 hover:bg-brand-50'
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${baseCls}`}
            >
              {s}
              {s !== ALL && (
                <span className={`ml-1.5 ${active ? 'text-white/70' : 'text-stone-400'}`}>
                  {tickets.filter((t) => t.status === s).length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      {displayed.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-8 text-sm text-stone-400 text-center">
          沒有符合條件的案件
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/tickets/${ticket.id}`}
              className="card-soft card-soft-hover group flex min-h-20 items-center justify-between gap-3 bg-white px-4 py-4 sm:gap-4 sm:px-5 active:scale-[0.995] transition-all"
            >
              {/* Left */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-stone-700 font-mono shrink-0">
                    {ticket.number || '—'}
                  </span>
                  {ticket.priority && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority] ?? 'bg-stone-100 text-stone-500'}`}>
                      {ticket.priority}
                    </span>
                  )}
                </div>
                <div className="font-medium text-stone-800 truncate group-hover:text-brand-700 transition-colors">
                  {ticket.customerName}
                  {ticket.title && ticket.title !== ticket.customerName && (
                    <span className="text-stone-400 font-normal ml-2 text-sm">— {ticket.title}</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-stone-400 flex flex-wrap gap-x-3">
                  {ticket.createdDate && (
                    <span className="text-stone-400">{formatDate(ticket.createdDate)}</span>
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
                <span className="text-stone-300 group-hover:text-brand-500 transition-colors text-sm">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
