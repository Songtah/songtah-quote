'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { AppShell } from '@/components/AppShell'
import { VisitModal } from '@/components/VisitsContent'
import type { Equipment, Ticket } from '@/types'
import type { SystemCustomerDetail, Visit, EventRegistration } from '@/lib/system-notion'

type QuoteSummary = { id: string; quoteNumber: string; status: string; total: number; createdAt: string }
type OrderSummary = { id: string; orderNumber: string; status: string; totalAmount: number; createdTime: string }

type CustomerData = {
  customer: SystemCustomerDetail
  equipment: Equipment[]
  tickets: Ticket[]
  visits: Visit[]
  quotes: QuoteSummary[]
  orders: OrderSummary[]
}

type EquipmentDetail = {
  id: string
  customerName: string
  customerId: string
  productName: string
  manufacturer: string
  serialNumber: string
  status: string
  supportId: string
  teamViewerId: string
  dongleSerial: string
  note: string
  warrantyEnd: string
  activationDate: string
  thumbnail: string
}

const TICKETS_PREVIEW = 5
const EQ_PREVIEW = 4

const EQUIPMENT_STATUS_STYLES: Record<string, string> = {
  '正常':    'bg-blue-100 text-blue-700',
  '新機':    'bg-brand-50 text-green-700',
  '高齡設備': 'bg-red-100 text-red-700',
  '報廢':    'bg-stone-100 text-stone-500',
  '借用中':  'bg-yellow-100 text-yellow-700',
  '狀態不明': 'bg-orange-100 text-orange-700',
}

// ── avatar color ──────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'from-blue-400 to-blue-600',
  'from-brand-400 to-brand-600',
  'from-purple-400 to-purple-600',
  'from-orange-400 to-orange-500',
  'from-brand-400 to-brand-600',
  'from-rose-400 to-rose-600',
]
function avatarGradient(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [data, setData] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [ticketsExpanded, setTicketsExpanded] = useState(false)
  const [visitsExpanded, setVisitsExpanded] = useState(false)
  const [eqExpanded, setEqExpanded] = useState(false)
  const [customerEvents, setCustomerEvents] = useState<EventRegistration[]>([])
  const [eventsExpanded, setEventsExpanded] = useState(false)

  const [selectedEq, setSelectedEq] = useState<EquipmentDetail | null>(null)
  const [eqLoading, setEqLoading] = useState(false)
  const [eqEditing, setEqEditing] = useState(false)
  const [eqForm, setEqForm] = useState<Partial<EquipmentDetail>>({})
  const [eqSaving, setEqSaving] = useState(false)

  const [showVisitModal, setShowVisitModal] = useState(false)

  const [eqOrder, setEqOrder] = useState<string[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const storageKey = `eq-order-${params.id}`

  useEffect(() => {
    fetch(`/api/customers/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        const defaultOrder = d.equipment.map((e: Equipment) => e.id) as string[]
        try {
          const saved = localStorage.getItem(storageKey)
          if (saved) {
            const parsed: string[] = JSON.parse(saved)
            const newIds = defaultOrder.filter((id) => !parsed.includes(id))
            setEqOrder([...parsed.filter((id: string) => defaultOrder.includes(id)), ...newIds])
            return
          }
        } catch {}
        setEqOrder(defaultOrder)
      })
      .catch(() => setError('無法載入客戶資料'))
      .finally(() => setLoading(false))

    // load events (non-blocking)
    fetch(`/api/customers/${params.id}/events`)
      .then(r => r.ok ? r.json() : [])
      .then(evs => setCustomerEvents(Array.isArray(evs) ? evs : []))
      .catch(() => {})
  }, [params.id])

  function openEquipment(eqId: string) {
    setEqLoading(true)
    setSelectedEq(null)
    setEqEditing(false)
    fetch(`/api/equipment/${eqId}`)
      .then((r) => r.json())
      .then((d) => setSelectedEq(d))
      .finally(() => setEqLoading(false))
  }

  function startEdit() {
    if (!selectedEq) return
    setEqForm({
      status: selectedEq.status,
      serialNumber: selectedEq.serialNumber,
      supportId: selectedEq.supportId,
      teamViewerId: selectedEq.teamViewerId,
      dongleSerial: selectedEq.dongleSerial,
      note: selectedEq.note,
      warrantyEnd: selectedEq.warrantyEnd?.slice(0, 10) ?? '',
      activationDate: selectedEq.activationDate?.slice(0, 10) ?? '',
    })
    setEqEditing(true)
  }

  async function saveEdit() {
    if (!selectedEq) return
    setEqSaving(true)
    try {
      const res = await fetch(`/api/equipment/${selectedEq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eqForm),
      })
      const updated = await res.json()
      setSelectedEq(updated)
      setEqEditing(false)
      fetch(`/api/customers/${params.id}`)
        .then((r) => r.json())
        .then((d) => { if (!d.error) setData(d) })
    } finally {
      setEqSaving(false)
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const allTags = data
    ? Array.from(new Set((data.visits ?? []).flatMap((v) => v.tags ?? [])))
    : []

  const lastVisit = data?.visits?.[0]
  const openTickets = data?.tickets.filter((t) => t.status && !['已結案', '關閉', 'Closed'].includes(t.status)) ?? []

  return (
    <AppShell title="客戶管理" description="客戶主檔、設備清單與相關工單紀錄。">

      {/* ── Back ──────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-brand-700 active:scale-95 transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          返回客戶列表
        </button>
      </div>

      {/* ── Loading skeleton ──────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel p-6 h-32 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="panel p-6 text-sm text-red-600">{error}</div>
      )}

      {data && (
        <div className="space-y-5">

          {/* ── Hero card ─────────────────────────────────────────────────── */}
          <div className="card-soft overflow-hidden">
            {/* Gradient header */}
            <div className="px-6 pt-6 pb-5 flex items-start gap-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarGradient(data.customer.name)} flex items-center justify-center text-2xl font-bold text-white shrink-0 shadow-sm`}>
                {data.customer.name.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-stone-800 leading-snug">{data.customer.name}</h1>
                  <div className="flex items-center gap-2 flex-wrap">
                    {data.customer.type && (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">
                        {data.customer.type}
                      </span>
                    )}
                    {data.customer.status && data.customer.status !== '正常' && data.customer.status !== '正常營業' && (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        {data.customer.status}
                      </span>
                    )}
                    {data.customer.devStage && (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                        🎯 {data.customer.devStage}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-stone-400 mt-1">
                  {[data.customer.city, data.customer.district].filter(Boolean).join('・')}
                  {data.customer.address && ` · ${data.customer.address}`}
                </p>
                {data.customer.salesperson && (
                  <p className="text-sm text-stone-600 mt-1">負責業務：<span className="font-semibold text-stone-800">{data.customer.salesperson}</span></p>
                )}
              </div>
            </div>

            {/* Quick stats row */}
            <div className="grid grid-cols-3 divide-x divide-stone-900/[0.06] border-t border-stone-900/[0.06] bg-stone-50/40">
              <StatCell
                label="設備"
                value={`${data.equipment.length} 台`}
                color={data.equipment.length > 0 ? 'text-brand-700' : 'text-stone-400'}
              />
              <StatCell
                label="未結工單"
                value={`${openTickets.length} 筆`}
                color={openTickets.length > 0 ? 'text-amber-600' : 'text-stone-400'}
              />
              <StatCell
                label="最後拜訪"
                value={lastVisit?.date ? lastVisit.date.slice(0, 10).replace(/-/g, '/') : '—'}
                color="text-stone-600"
              />
            </div>

            {/* Quick actions */}
            <div className="px-6 py-4 border-t border-stone-900/[0.06] flex gap-2 flex-wrap">
              <button
                onClick={() => setShowVisitModal(true)}
                className="button-primary gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                新增客情
              </button>
              <Link
                href="/tickets/new"
                className="button-secondary gap-1.5"
              >
                建立工單
              </Link>
              <Link
                href="/quote/new"
                className="button-secondary gap-1.5"
              >
                建立報價單
              </Link>
            </div>
          </div>

          {/* ── Info grid ──────────────────────────────────────────────────── */}
          <div className="card-soft p-6">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-4">基本資訊</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
              {data.customer.phone      && <InfoField label="電話" value={data.customer.phone} />}
              {data.customer.taxId      && <InfoField label="統一編號" value={data.customer.taxId} />}
              {data.customer.institutionCode && <InfoField label="機構代碼" value={data.customer.institutionCode} />}
              {data.customer.dentistCount > 0 && (
                <InfoField label="牙醫師數" value={`${data.customer.dentistCount} 人`} />
              )}
              {data.customer.technicianCount > 0 && (
                <InfoField label="牙體技術師" value={`${data.customer.technicianCount} 人`} />
              )}
              {data.customer.technicianTraineeCount > 0 && (
                <InfoField label="技術生" value={`${data.customer.technicianTraineeCount} 人`} />
              )}
            </div>
          </div>

          {/* ── Quotes & Orders ──────────────────────────────────────────────── */}
          <div className="card-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">報價與訂單</h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                {data.quotes.length} 張報價・{data.orders.length} 張訂單
              </span>
            </div>
            {data.quotes.length === 0 && data.orders.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                尚無報價或訂單紀錄
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-400 mb-2">報價單</p>
                  <div className="space-y-1.5">
                    {data.quotes.slice(0, 5).map((q) => (
                      <Link
                        key={q.id}
                        href={`/quotes`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-slate-300 hover:bg-slate-50 transition-colors"
                      >
                        <span className="font-mono text-slate-700 truncate">{q.quoteNumber}</span>
                        <span className="text-slate-400 shrink-0">{q.total ? `NT$ ${q.total.toLocaleString()}` : ''}</span>
                        <span className="text-xs text-slate-500 shrink-0">{q.status}</span>
                      </Link>
                    ))}
                    {data.quotes.length === 0 && <p className="text-xs text-slate-300">尚無報價單</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-2">訂購單</p>
                  <div className="space-y-1.5">
                    {data.orders.slice(0, 5).map((o) => (
                      <Link
                        key={o.id}
                        href={`/orders/${o.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-slate-300 hover:bg-slate-50 transition-colors"
                      >
                        <span className="font-mono text-slate-700 truncate">{o.orderNumber}</span>
                        <span className="text-slate-400 shrink-0">{o.totalAmount ? `NT$ ${o.totalAmount.toLocaleString()}` : ''}</span>
                        <span className="text-xs text-slate-500 shrink-0">{o.status}</span>
                      </Link>
                    ))}
                    {data.orders.length === 0 && <p className="text-xs text-slate-300">尚無訂購單</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Tags ─────────────────────────────────────────────────────────── */}
          {allTags.length > 0 && (
            <div className="card-soft p-6">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">客戶標籤</h2>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <span key={tag} className="text-sm bg-brand-50 text-green-700 border border-brand-200 px-3 py-1 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Equipment ────────────────────────────────────────────────────── */}
          <div className="card-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">設備清單</h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                {data.equipment.length} 台
              </span>
            </div>
            {data.equipment.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                尚無設備紀錄
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(eqOrder.length > 0
                    ? eqOrder.map((id) => data.equipment.find((e) => e.id === id)).filter(Boolean) as Equipment[]
                    : data.equipment
                  ).slice(0, eqExpanded ? undefined : EQ_PREVIEW).map((eq) => (
                    <div
                      key={eq.id}
                      draggable
                      onDragStart={() => setDragId(eq.id)}
                      onDragOver={(e) => { e.preventDefault(); setOverId(eq.id) }}
                      onDrop={() => {
                        if (!dragId || dragId === eq.id) { setDragId(null); setOverId(null); return }
                        setEqOrder((prev) => {
                          const next = [...prev]
                          const from = next.indexOf(dragId)
                          const to = next.indexOf(eq.id)
                          next.splice(from, 1)
                          next.splice(to, 0, dragId)
                          try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
                          return next
                        })
                        setDragId(null); setOverId(null)
                      }}
                      onDragEnd={() => { setDragId(null); setOverId(null) }}
                      onClick={() => openEquipment(eq.id)}
                      className={`rounded-xl border p-3 text-sm flex flex-col gap-2 transition-all text-left cursor-grab active:cursor-grabbing select-none
                        ${dragId === eq.id ? 'opacity-40 scale-95' : 'hover:border-slate-300 hover:shadow-sm'}
                        ${overId === eq.id && dragId !== eq.id ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-200'}
                      `}
                    >
                      <div className="w-full aspect-[4/3] rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                        {eq.thumbnail ? (
                          <img src={eq.thumbnail} alt={eq.productName || eq.manufacturer} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-slate-300 text-3xl">📦</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1 mb-0.5">
                          <div className="font-medium text-slate-900 leading-snug">{eq.productName || eq.manufacturer || '未知機型'}</div>
                          {eq.status && <EquipmentStatusBadge status={eq.status} />}
                        </div>
                        <div className="text-slate-500 flex flex-col gap-0.5">
                          {eq.manufacturer && <span>{eq.manufacturer}</span>}
                          {eq.serialNumber && <span>序號 {eq.serialNumber}</span>}
                          {eq.supportId && <span>Support {eq.supportId}</span>}
                          {eq.teamViewerId && <span>TV {eq.teamViewerId}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {data.equipment.length > EQ_PREVIEW && (
                  <button
                    onClick={() => setEqExpanded((v) => !v)}
                    className="w-full pt-3 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {eqExpanded ? '▲ 收合' : `▼ 顯示其餘 ${data.equipment.length - EQ_PREVIEW} 台`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Visits ────────────────────────────────────────────────────────── */}
          <div className="card-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">拜訪紀錄</h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                {(data.visits ?? []).length} 筆
              </span>
            </div>
            {(data.visits ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                尚無拜訪紀錄
              </p>
            ) : (
              <div className="space-y-2">
                {(visitsExpanded ? data.visits : data.visits.slice(0, 5)).map((v) => (
                  <div key={v.id} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-slate-900">
                        {v.date ? v.date.slice(0, 10).replace(/-/g, '/') : '—'}
                        {v.salesperson && <span className="ml-2 font-normal text-slate-500">{v.salesperson}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {v.needsFollowUp && (
                          <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">待追蹤</span>
                        )}
                        {v.status && (
                          <span className="text-xs bg-brand-50 text-green-700 px-2 py-0.5 rounded-full">{v.status}</span>
                        )}
                      </div>
                    </div>
                    {v.content && (
                      <div className="text-slate-500 mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{v.content}</div>
                    )}
                    {v.customerReaction && (
                      <div className="mt-2 pt-2 border-t border-slate-100 text-[13px] text-slate-400">
                        客戶反應：{v.customerReaction}
                      </div>
                    )}
                  </div>
                ))}
                {data.visits.length > 5 && (
                  <button
                    onClick={() => setVisitsExpanded((v) => !v)}
                    className="w-full pt-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {visitsExpanded ? '▲ 收合' : `▼ 顯示其餘 ${data.visits.length - 5} 筆`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Tickets ───────────────────────────────────────────────────────── */}
          <div className="card-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">技術支援工單</h2>
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                {data.tickets.length} 筆
              </span>
            </div>
            {data.tickets.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                尚無工單紀錄
              </p>
            ) : (
              <div className="space-y-2">
                {(ticketsExpanded ? data.tickets : data.tickets.slice(0, TICKETS_PREVIEW)).map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="block rounded-xl border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-slate-900">
                        {t.number && <span className="text-green-800 mr-1.5">{t.number}</span>}
                        {t.title}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {t.status && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            ['已結案', '關閉'].includes(t.status)
                              ? 'bg-stone-100 text-stone-400'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {t.status}
                          </span>
                        )}
                        {t.priority && (
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {t.priority}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {[t.ticketType, t.createdDate?.slice(0, 10).replace(/-/g, '/')].filter(Boolean).join('・')}
                    </div>
                  </Link>
                ))}
                {data.tickets.length > TICKETS_PREVIEW && (
                  <button
                    onClick={() => setTicketsExpanded((v) => !v)}
                    className="w-full pt-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {ticketsExpanded ? '▲ 收合' : `▼ 顯示其餘 ${data.tickets.length - TICKETS_PREVIEW} 筆`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── 參加活動 ───────────────────────────────────────────────────── */}
          <div className="card-soft p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">參加活動</h2>
              <span className="text-xs text-stone-400">{customerEvents.length} 筆</span>
            </div>
            {customerEvents.length === 0 ? (
              <p className="text-sm text-stone-400">尚無活動報名紀錄</p>
            ) : (
              <div className="space-y-2">
                {(eventsExpanded ? customerEvents : customerEvents.slice(0, 3)).map(ev => (
                  <Link
                    key={ev.id}
                    href={`/events/${ev.eventId}`}
                    className="flex items-center justify-between rounded-2xl border border-stone-900/[0.06] p-3 hover:bg-brand-50/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{ev.institution}</p>
                      <p className="text-xs text-stone-400">{ev.registeredAt ? new Date(ev.registeredAt).toLocaleDateString('zh-TW') : ''}</p>
                    </div>
                    <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      ev.status === '已確認' ? 'bg-brand-50 text-green-700' :
                      ev.status === '取消'   ? 'bg-red-100 text-red-600' :
                      'bg-blue-100 text-blue-700'
                    }`}>{ev.status}</span>
                  </Link>
                ))}
                {customerEvents.length > 3 && (
                  <button
                    onClick={() => setEventsExpanded(v => !v)}
                    className="w-full pt-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {eventsExpanded ? '▲ 收合' : `▼ 顯示其餘 ${customerEvents.length - 3} 筆`}
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── New Visit Modal ────────────────────────────────────────────────── */}
      {showVisitModal && data && (
        <VisitModal
          prefillCustomer={{
            id: params.id,
            name: data.customer.name,
            city: data.customer.city ?? '',
            district: data.customer.district ?? '',
            address: data.customer.address ?? '',
          }}
          onClose={() => setShowVisitModal(false)}
          onSaved={() => {
            setShowVisitModal(false)
            fetch(`/api/customers/${params.id}`)
              .then((r) => r.json())
              .then((d) => { if (!d.error) setData(d) })
          }}
        />
      )}

      {/* ── Equipment Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(eqLoading || selectedEq) && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => { setSelectedEq(null); setEqEditing(false) }}
            />
            <motion.div
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="relative bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl"
                initial={{ opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                onClick={(e) => e.stopPropagation()}
              >
                {eqLoading ? (
                  <div className="p-8 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
                  </div>
                ) : selectedEq && (
                  <>
                    {selectedEq.thumbnail && (
                      <div className="w-full bg-cream-50 rounded-t-2xl overflow-hidden flex items-center justify-center" style={{ maxHeight: 220 }}>
                        <img src={selectedEq.thumbnail} alt={selectedEq.productName} className="object-contain w-full" style={{ maxHeight: 220 }} />
                      </div>
                    )}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h2 className="text-lg font-semibold text-slate-900">
                          {selectedEq.productName || selectedEq.manufacturer || '未知機型'}
                        </h2>
                        <div className="flex items-center gap-2 shrink-0">
                          {!eqEditing && (
                            <button onClick={startEdit} className="text-xs text-brand-700 border border-brand-300 px-2 py-1 rounded-lg hover:bg-brand-50 transition">
                              編輯
                            </button>
                          )}
                          <button onClick={() => { setSelectedEq(null); setEqEditing(false) }} className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition text-base leading-none mt-0.5">✕</button>
                        </div>
                      </div>
                      {selectedEq.manufacturer && <p className="text-sm text-slate-500 mb-3">{selectedEq.manufacturer}</p>}

                      {eqEditing ? (
                        <div className="space-y-3 text-sm">
                          <div>
                            <label className="text-xs text-stone-400 block mb-1">產品狀態</label>
                            <select
                              value={eqForm.status ?? ''}
                              onChange={(e) => setEqForm((f) => ({ ...f, status: e.target.value }))}
                              className="w-full border border-brand-200/60 bg-cream-50/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                            >
                              <option value="">— 未設定 —</option>
                              {['正常','新機','高齡設備','報廢','借用中','狀態不明'].map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                          {([
                            ['serialNumber', '序號'],
                            ['supportId', 'Support ID'],
                            ['teamViewerId', 'TeamViewer ID'],
                            ['dongleSerial', 'Dongle 序號'],
                          ] as [keyof typeof eqForm, string][]).map(([field, label]) => (
                            <div key={field}>
                              <label className="text-xs text-stone-400 block mb-1">{label}</label>
                              <input
                                type="text"
                                value={(eqForm[field] as string) ?? ''}
                                onChange={(e) => setEqForm((f) => ({ ...f, [field]: e.target.value }))}
                                className="w-full border border-brand-200/60 bg-cream-50/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                              />
                            </div>
                          ))}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-stone-400 block mb-1">啟用日期</label>
                              <input type="date" value={eqForm.activationDate ?? ''} onChange={(e) => setEqForm((f) => ({ ...f, activationDate: e.target.value }))} className="w-full border border-brand-200/60 bg-cream-50/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                            </div>
                            <div>
                              <label className="text-xs text-stone-400 block mb-1">保固結束日期</label>
                              <input type="date" value={eqForm.warrantyEnd ?? ''} onChange={(e) => setEqForm((f) => ({ ...f, warrantyEnd: e.target.value }))} className="w-full border border-brand-200/60 bg-cream-50/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-stone-400 block mb-1">備註</label>
                            <textarea
                              rows={3}
                              value={eqForm.note ?? ''}
                              onChange={(e) => setEqForm((f) => ({ ...f, note: e.target.value }))}
                              className="w-full border border-brand-200/60 bg-cream-50/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button onClick={saveEdit} disabled={eqSaving} className="button-primary flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                              {eqSaving ? '儲存中…' : '儲存'}
                            </button>
                            <button onClick={() => setEqEditing(false)} className="button-secondary flex-1 py-2 rounded-lg text-sm">取消</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {selectedEq.status && (
                            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-4 ${EQUIPMENT_STATUS_STYLES[selectedEq.status] ?? 'bg-stone-100 text-stone-500'}`}>
                              {selectedEq.status}
                            </span>
                          )}
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            {selectedEq.serialNumber && <InfoRow label="序號" value={selectedEq.serialNumber} />}
                            {selectedEq.supportId && <InfoRow label="Support ID" value={selectedEq.supportId} />}
                            {selectedEq.teamViewerId && <InfoRow label="TeamViewer ID" value={selectedEq.teamViewerId} />}
                            {selectedEq.dongleSerial && <InfoRow label="Dongle 序號" value={selectedEq.dongleSerial} />}
                            {selectedEq.activationDate && <InfoRow label="啟用日期" value={selectedEq.activationDate.slice(0,10).replace(/-/g,'/')} />}
                            {selectedEq.warrantyEnd && <InfoRow label="保固結束" value={selectedEq.warrantyEnd.slice(0,10).replace(/-/g,'/')} />}
                          </div>
                          {selectedEq.note && (
                            <div className="mt-4 pt-4 border-t border-slate-100">
                              <dt className="text-xs text-slate-400 mb-1">備註</dt>
                              <dd className="text-sm text-slate-700 whitespace-pre-wrap">{selectedEq.note}</dd>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AppShell>
  )
}

// ─── Small components ──────────────────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center py-3 px-2">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-xs text-stone-400 mt-0.5">{label}</span>
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-400 mb-0.5">{label}</dt>
      <dd className="text-stone-900 font-medium">{value || '—'}</dd>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-900 font-medium">{value}</dd>
    </div>
  )
}

function EquipmentStatusBadge({ status }: { status: string }) {
  const cls = EQUIPMENT_STATUS_STYLES[status] ?? 'bg-stone-100 text-stone-500'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${cls}`}>
      {status}
    </span>
  )
}
