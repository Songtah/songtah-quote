'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Quote } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}
function formatDate(d: string) {
  if (!d) return '—'
  return d.slice(0, 10).replace(/-/g, '/')
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  待行政審核:    { label: '待行政審核',   cls: 'bg-amber-100  text-amber-700  border-amber-200',  dot: 'bg-amber-400'  },
  待總經理審核:  { label: '待總經理審核', cls: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
  已核准:        { label: '✓ 已核准',     cls: 'bg-brand-50  text-green-700  border-brand-200',  dot: 'bg-brand-500'  },
  已退回:        { label: '✗ 已退回',     cls: 'bg-red-100    text-red-600    border-red-200',    dot: 'bg-red-400'    },
  草稿:          { label: '草稿',         cls: 'bg-stone-100  text-stone-500  border-stone-200',  dot: 'bg-stone-300'  },
}

const TABS = ['待審核', '待總經理', '已核准', '已退回', '全部'] as const
type Tab = typeof TABS[number]

function tabStatuses(tab: Tab): string[] {
  if (tab === '待審核')   return ['待行政審核']
  if (tab === '待總經理') return ['待總經理審核']
  if (tab === '已核准')   return ['已核准']
  if (tab === '已退回')   return ['已退回']
  return []   // 全部
}

// ── Approval modal ────────────────────────────────────────────────────────────

type ApprovalAction = 'approve' | 'escalate' | 'reject' | 'resubmit'

const ACTION_META: Record<ApprovalAction, {
  icon: string; title: string; btn: string; btnCls: string; needNote: boolean
}> = {
  approve:  { icon: '✅', title: '核准此報價單',     btn: '確認核准', btnCls: 'bg-brand-600 hover:bg-brand-700',   needNote: false },
  escalate: { icon: '📋', title: '呈送總經理審核',   btn: '呈總經理', btnCls: 'bg-orange-500 hover:bg-orange-600', needNote: false },
  reject:   { icon: '↩︎', title: '退回此報價單',    btn: '確認退回', btnCls: 'bg-red-500 hover:bg-red-600',       needNote: true  },
  resubmit: { icon: '🔄', title: '重新送交行政審核', btn: '重新送審', btnCls: 'bg-brand-500 hover:bg-brand-600',   needNote: false },
}

function ApprovalModal({
  quote, action, onConfirm, onCancel, loading,
}: {
  quote: Quote; action: ApprovalAction
  onConfirm: (note: string) => void; onCancel: () => void; loading: boolean
}) {
  const [note, setNote] = useState('')
  const m = ACTION_META[action]

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onCancel}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="text-3xl mb-3">{m.icon}</div>
        <h3 className="text-lg font-bold text-stone-800 mb-4">{m.title}</h3>

        {/* Quote summary */}
        <div className="bg-stone-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-400">報價單號</span>
            <span className="font-mono font-bold text-stone-700">{quote.quoteNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">客戶</span>
            <span className="font-medium text-stone-700">{quote.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">金額</span>
            <span className="font-semibold text-brand-700">{formatMoney(quote.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">業務</span>
            <span className="text-stone-600">{quote.salesperson || '—'}</span>
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-stone-500 mb-1.5">
            審核意見
            {m.needNote
              ? <span className="text-red-500 ml-1">*（退回必填）</span>
              : <span className="text-stone-400 ml-1">（選填）</span>}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full border border-stone-300 rounded-xl px-3 py-2.5 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            placeholder="填寫審核說明或退回原因…"
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 rounded-xl border border-stone-200 bg-white text-stone-600 text-sm font-medium px-4 py-2.5 hover:bg-stone-50 transition disabled:opacity-60">
            取消
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading || (m.needNote && !note.trim())}
            className={`flex-1 rounded-xl text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-50 ${m.btnCls}`}
          >
            {loading ? '處理中…' : m.btn}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Quote row ─────────────────────────────────────────────────────────────────

function QuoteRow({
  quote, actions, onAction,
}: {
  quote: Quote
  actions: ApprovalAction[]
  onAction: (quote: Quote, action: ApprovalAction) => void
}) {
  const meta = STATUS_META[quote.status] ?? { label: quote.status, cls: 'bg-stone-100 text-stone-500 border-stone-200', dot: 'bg-stone-300' }

  return (
    <div className="card-soft card-soft-hover space-y-3 px-5 py-4">
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-stone-700">{quote.quoteNumber}</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
              {meta.label}
            </span>
          </div>
          <div className="mt-1 truncate font-semibold text-stone-800">{quote.customerName}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-stone-400">
            {quote.salesperson && <span>業務：{quote.salesperson}</span>}
            {quote.createdAt   && <span>建立：{formatDate(quote.createdAt)}</span>}
            {quote.validUntil  && <span>有效至：{formatDate(quote.validUntil)}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-brand-700">{formatMoney(quote.total)}</div>
          <a
            href={`/share/${quote.id}`}
            target="_blank" rel="noreferrer"
            className="text-xs text-brand-500 hover:underline"
          >
            預覽 →
          </a>
        </div>
      </div>

      {/* Approval note */}
      {quote.approvalNote && (
        <div className={`text-xs rounded-xl px-3 py-2 border ${
          quote.status === '已退回'
            ? 'bg-red-50 border-red-100 text-red-600'
            : 'bg-amber-50 border-amber-100 text-amber-700'
        }`}>
          <span className="font-semibold">審核意見：</span>{quote.approvalNote}
        </div>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-900/[0.06] pt-3">
          <span className="text-xs text-stone-400">下一步：</span>
          {actions.includes('approve') && (
            <button
              onClick={() => onAction(quote, 'approve')}
              className="rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-brand-700 active:scale-95"
            >
              ✓ 核准
            </button>
          )}
          {actions.includes('escalate') && (
            <button
              onClick={() => onAction(quote, 'escalate')}
              className="rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-orange-600 active:scale-95"
            >
              ↑ 呈總經理
            </button>
          )}
          {actions.includes('reject') && (
            <button
              onClick={() => onAction(quote, 'reject')}
              className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition-all hover:bg-red-100 active:scale-95"
            >
              ✗ 退回
            </button>
          )}
          {actions.includes('resubmit') && (
            <button
              onClick={() => onAction(quote, 'resubmit')}
              className="rounded-full border border-brand-200 bg-brand-50 px-4 py-2 text-xs font-semibold text-brand-700 transition-all hover:bg-brand-100 active:scale-95"
            >
              🔄 重新送審
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminQuoteContent() {
  const { data: session } = useSession()
  const user        = (session?.user as any) ?? {}
  const role        = user?.role        ?? ''
  const accountType = user?.accountType ?? ''

  const isAdmin = role === 'admin'
  const isStaff = accountType === '行政'

  function allowedActions(status: string): ApprovalAction[] {
    if (isAdmin) {
      if (status === '待行政審核')   return ['approve', 'reject']
      if (status === '待總經理審核') return ['approve', 'reject']
      if (status === '已退回')       return ['resubmit']
    }
    if (isStaff) {
      if (status === '待行政審核')   return ['approve', 'escalate', 'reject']
      if (status === '待總經理審核') return ['approve', 'reject']
      if (status === '已退回')       return ['resubmit']
    }
    return []
  }

  const [quotes, setQuotes]   = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('待審核')

  // Approval modal
  const [modalTarget,  setModalTarget]  = useState<{ quote: Quote; action: ApprovalAction } | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [approving,    setApproving]    = useState(false)

  function loadQuotes() {
    setLoading(true)
    fetch('/api/quotes')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '讀取失敗')
        setQuotes(Array.isArray(data) ? data : [])
      })
      .catch((err: Error) => setError(err.message || '讀取失敗'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadQuotes() }, [])

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    pendingAdmin: quotes.filter((q) => q.status === '待行政審核').length,
    pendingGM:    quotes.filter((q) => q.status === '待總經理審核').length,
    approved:     quotes.filter((q) => q.status === '已核准').length,
    rejected:     quotes.filter((q) => q.status === '已退回').length,
  }), [quotes])

  // ── Filtered list ──────────────────────────────────────────────
  const displayed = useMemo(() => {
    const statuses = tabStatuses(activeTab)
    return statuses.length === 0
      ? quotes
      : quotes.filter((q) => statuses.includes(q.status))
  }, [quotes, activeTab])

  // ── Approval handlers ──────────────────────────────────────────
  function openModal(quote: Quote, action: ApprovalAction) {
    setModalTarget({ quote, action }); setModalVisible(true)
  }
  function closeModal() {
    setModalVisible(false)
    setTimeout(() => setModalTarget(null), 220)
  }
  async function confirmApproval(note: string) {
    if (!modalTarget) return
    setApproving(true)
    try {
      const res = await fetch(`/api/quotes/${modalTarget.quote.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: modalTarget.action, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '操作失敗')
      setQuotes((prev) =>
        prev.map((q) =>
          q.id === modalTarget.quote.id
            ? { ...q, status: data.status as Quote['status'], approvalNote: note || q.approvalNote }
            : q
        )
      )
      closeModal()
    } catch (err: any) {
      alert(err.message ?? '操作失敗，請稍後再試')
    } finally {
      setApproving(false)
    }
  }

  // ── Tab labels with counts ─────────────────────────────────────
  const TAB_LABELS: Record<Tab, string> = {
    '待審核':   `待行政審核 ${stats.pendingAdmin > 0 ? `(${stats.pendingAdmin})` : ''}`,
    '待總經理': `待總經理審核 ${stats.pendingGM > 0 ? `(${stats.pendingGM})` : ''}`,
    '已核准':   '已核准',
    '已退回':   '已退回',
    '全部':     '全部',
  }

  return (
    <>
      {/* ── Stats ── */}
      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: '待行政審核', value: stats.pendingAdmin, cls: 'text-amber-600',  urgent: stats.pendingAdmin > 0 },
          { label: '待總經理審核', value: stats.pendingGM,  cls: 'text-orange-600', urgent: stats.pendingGM > 0   },
          { label: '已核准',     value: stats.approved,    cls: 'text-green-600',  urgent: false },
          { label: '已退回',     value: stats.rejected,    cls: 'text-red-500',    urgent: false },
        ].map(({ label, value, cls, urgent }) => (
          <div key={label} className={`panel p-5 ${urgent ? 'ring-2 ring-amber-300/50' : ''}`}>
            <p className="eyebrow mb-2 text-xs">{label}</p>
            {loading
              ? <div className="h-8 w-12 animate-pulse rounded-lg bg-stone-200" />
              : <p className={`text-3xl font-black ${cls}`}>{value}</p>
            }
          </div>
        ))}
      </section>

      {/* ── Queue panel ── */}
      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between">
          <div><p className="eyebrow mb-1 text-xs">待辦工作</p><h3 className="text-lg font-bold text-stone-800">報價簽核</h3></div>
          <button
            onClick={loadQuotes}
            className="button-secondary px-4 py-2 text-xs"
          >
            ↻ 重新整理
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-5 flex gap-2 overflow-x-auto border-b border-stone-900/[0.06] pb-4">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                activeTab === tab
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
            {error}
            <button onClick={loadQuotes} className="ml-3 underline hover:no-underline">重試</button>
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-2xl bg-stone-50 px-5 py-12 text-center text-sm text-stone-400 ring-1 ring-stone-900/[0.06]">
            {activeTab === '全部' ? '目前沒有報價單' : '此分類目前沒有報價單'}
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((quote) => (
              <QuoteRow
                key={quote.id}
                quote={quote}
                actions={allowedActions(quote.status)}
                onAction={openModal}
              />
            ))}
          </div>
        )}
      </section>

      {/* Approval modal */}
      <AnimatePresence>
        {modalVisible && modalTarget && (
          <ApprovalModal
            quote={modalTarget.quote}
            action={modalTarget.action}
            onConfirm={confirmApproval}
            onCancel={closeModal}
            loading={approving}
          />
        )}
      </AnimatePresence>
    </>
  )
}
