'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { AppShell } from '@/components/AppShell'
import type { Ticket, UpdateTicketPayload } from '@/types'
import {
  TICKET_PRIORITIES,
  TICKET_SALES_OWNERS,
  TICKET_STATUSES,
  TICKET_SUPPORT_OWNERS,
  isValidTicketStatusTransition,
} from '@/lib/ticket-validation'

const STATUS_STYLES: Record<string, string> = {
  '尚未處理': 'bg-orange-100 text-orange-700 border border-orange-200',
  '🔧 維修中': 'bg-blue-100 text-blue-700 border border-blue-200',
  '👌 已受理': 'bg-blue-100 text-blue-700 border border-blue-200',
  '🔍 診斷問題中': 'bg-sky-100 text-sky-700 border border-sky-200',
  '⚙️ 測試中': 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  '🔍 後續追蹤': 'bg-purple-100 text-purple-700 border border-purple-200',
  '✅ 結案': 'bg-brand-50 text-green-700 border border-brand-200',
}

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'bg-red-100 text-red-700',
  P2: 'bg-amber-100 text-amber-700',
  P3: 'bg-stone-100 text-stone-600',
  P4: 'bg-stone-100 text-stone-500',
}

type EditForm = Required<Pick<
  UpdateTicketPayload,
  'status' | 'priority' | 'supportOwner' | 'salesOwner' | 'scheduledDate' | 'cause' | 'solution' | 'note'
>>

const EDIT_FIELDS: Array<keyof EditForm> = [
  'status', 'priority', 'supportOwner', 'salesOwner', 'scheduledDate', 'cause', 'solution', 'note',
]

function toEditForm(ticket: Ticket): EditForm {
  return {
    status: ticket.status || '尚未處理',
    priority: ticket.priority || '',
    supportOwner: ticket.supportOwner || '',
    salesOwner: ticket.salesOwner || '',
    scheduledDate: ticket.scheduledDate?.slice(0, 10) || '',
    cause: ticket.cause || '',
    solution: ticket.solution || '',
    note: ticket.note || '',
  }
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-stone-100 text-stone-600'
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
      <dt className="text-xs text-stone-400 mb-0.5">{label}</dt>
      <dd className="text-stone-800 font-medium text-sm">{value}</dd>
    </div>
  )
}

function TextBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="card-soft p-6">
      <h3 className="font-semibold text-stone-800 text-sm mb-2">{label}</h3>
      <p className="text-stone-600 text-sm whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  )
}

export default function TicketDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')

  const user = session?.user as any
  const permissions = user?.permissions
  const canEdit = Boolean(session) && (
    user?.role === 'admin' || !permissions || permissions?.rma?.edit === true
  )

  useEffect(() => {
    fetch(`/api/tickets/${params.id}`)
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '無法載入案件資料')
        setTicket(data)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '無法載入案件資料'))
      .finally(() => setLoading(false))
  }, [params.id])

  const startEditing = () => {
    if (!ticket) return
    setForm(toEditForm(ticket))
    setSaveError('')
  }

  const cancelEditing = () => {
    setForm(null)
    setSaveError('')
  }

  const updateForm = (field: keyof EditForm, value: string) => {
    setForm((current) => current ? { ...current, [field]: value } : current)
  }

  const saveTicket = async () => {
    if (!ticket || !form) return
    const original = toEditForm(ticket)
    const changes: UpdateTicketPayload = {}
    for (const field of EDIT_FIELDS) {
      if (form[field] !== original[field]) changes[field] = form[field]
    }
    if (Object.keys(changes).length === 0) {
      cancelEditing()
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch(`/api/tickets/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '更新案件失敗')
      setTicket(data)
      setForm(null)
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '更新案件失敗')
    } finally {
      setSaving(false)
    }
  }

  const pageTitle = ticket ? (ticket.customerName || ticket.title || '案件詳情') : '案件詳情'
  const pageDesc = ticket?.number ? `${ticket.number}・技術支援案件` : '技術支援案件詳細資訊'

  return (
    <AppShell title={pageTitle} description={pageDesc}>
      <div className="mb-4">
        <button
          onClick={() => router.back()}
          className="text-sm font-medium text-stone-500 hover:text-brand-600 active:scale-95 transition-all"
        >
          ← 返回
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="card-soft p-6 h-32 animate-pulse" />)}
        </div>
      )}

      {error && <div className="card-soft p-6 text-sm text-red-600">{error}</div>}

      {ticket && (
        <div className="space-y-5">
          <div className="card-soft p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-2xl font-black text-stone-800">{ticket.number || '—'}</span>
                  {ticket.priority && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority] ?? 'bg-stone-100 text-stone-600'}`}>
                      {ticket.priority}
                    </span>
                  )}
                </div>
                <p className="text-stone-600 text-sm">{ticket.title || ticket.customerName || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={ticket.status} />
                {canEdit && !form && (
                  <button
                    onClick={startEditing}
                    className="px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all"
                  >
                    編輯案件
                  </button>
                )}
              </div>
            </div>
          </div>

          {form && (
            <div className="card-soft p-6 space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">Service workflow</p>
                <h2 className="mt-1 text-lg font-bold text-stone-800">更新處理進度</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <label className="text-sm font-medium text-stone-600">
                  狀態
                  <select className="select-soft mt-1" value={form.status} onChange={(e) => updateForm('status', e.target.value)}>
                    {TICKET_STATUSES.filter(
                      (value) => value === form.status || (ticket && isValidTicketStatusTransition(ticket.status, value))
                    ).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-stone-600">
                  優先級
                  <select className="select-soft mt-1" value={form.priority} onChange={(e) => updateForm('priority', e.target.value)}>
                    <option value="">未設定</option>
                    {TICKET_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-stone-600">
                  技術支援對口
                  <select className="select-soft mt-1" value={form.supportOwner} onChange={(e) => updateForm('supportOwner', e.target.value)}>
                    <option value="">未指定</option>
                    {TICKET_SUPPORT_OWNERS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-stone-600">
                  業務窗口
                  <select className="select-soft mt-1" value={form.salesOwner} onChange={(e) => updateForm('salesOwner', e.target.value)}>
                    <option value="">未指定</option>
                    {TICKET_SALES_OWNERS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-medium text-stone-600 max-w-sm">
                預計維修日期
                <input className="input-soft mt-1" type="date" value={form.scheduledDate} onChange={(e) => updateForm('scheduledDate', e.target.value)} />
              </label>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {([
                  ['cause', '原因分析'],
                  ['solution', '解決方案'],
                  ['note', '備註'],
                ] as const).map(([field, label]) => (
                  <label key={field} className="text-sm font-medium text-stone-600">
                    {label}
                    <textarea
                      className="input-soft mt-1 min-h-32 resize-y"
                      value={form[field]}
                      maxLength={2000}
                      onChange={(e) => updateForm(field, e.target.value)}
                    />
                  </label>
                ))}
              </div>

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}

              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelEditing}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={saveTicket}
                  disabled={saving}
                  className="px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50"
                >
                  {saving ? '儲存中…' : '儲存變更'}
                </button>
              </div>
            </div>
          )}

          <div className="card-soft p-6">
            <h2 className="font-semibold text-stone-800 mb-4">基本資訊</h2>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Field label="客戶單位" value={ticket.customerName || '—'} />
              <Field label="案件類型" value={ticket.ticketType} />
              <Field label="生產商" value={ticket.manufacturer} />
              <Field label="聯絡人" value={ticket.contactName} />
              <Field label="技術支援對口" value={ticket.supportOwner} />
              <Field label="業務窗口" value={ticket.salesOwner} />
              <Field label="預計維修日期" value={formatDate(ticket.scheduledDate)} />
              <Field label="建立日期" value={formatDate(ticket.createdDate)} />
              {ticket.equipmentId && (
                <div>
                  <dt className="text-xs text-stone-400 mb-1">關聯設備</dt>
                  <dd>
                    <Link
                      href={`/equipment/${ticket.equipmentId}`}
                      className="inline-flex px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 hover:bg-brand-100 active:scale-95 transition-all"
                    >
                      查看設備資料 →
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <TextBlock label="情境描述" value={ticket.description} />
          <TextBlock label="原因分析" value={ticket.cause} />
          <TextBlock label="解決方案" value={ticket.solution} />
          <TextBlock label="備註" value={ticket.note} />
        </div>
      )}
    </AppShell>
  )
}
