'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import type { Quote } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function formatDate(d: string) {
  if (!d) return ''
  return d.slice(0, 10).replace(/-/g, '/')
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:          { label: '草稿',         cls: 'bg-stone-100  text-stone-500  border-stone-200'  },
  待行政審核:    { label: '待行政審核',   cls: 'bg-amber-100  text-amber-700  border-amber-200'  },
  待總經理審核:  { label: '待總經理審核', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  已核准:        { label: '✓ 已核准',     cls: 'bg-green-100  text-green-700  border-green-200'  },
  已退回:        { label: '✗ 已退回',     cls: 'bg-red-100    text-red-600    border-red-200'    },
  已送出:        { label: '已送出',        cls: 'bg-blue-100   text-blue-700   border-blue-200'   },
  已確認:        { label: '已確認',        cls: 'bg-brand-100  text-brand-700  border-brand-200'  },
  已過期:        { label: '已過期',        cls: 'bg-red-100    text-red-600    border-red-200'    },
}

const ALL = '全部'

// ── Approval Modal ────────────────────────────────────────────────────────────

type ApprovalAction = 'approve' | 'escalate' | 'reject' | 'resubmit'

function ApprovalModal({
  quote,
  action,
  onConfirm,
  onCancel,
  loading,
}: {
  quote: Quote
  action: ApprovalAction
  onConfirm: (note: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [note, setNote] = useState('')

  const meta: Record<ApprovalAction, { icon: string; title: string; btn: string; btnCls: string; noteRequired: boolean }> = {
    approve:   { icon: '✅', title: '確認核准報價單？',           btn: '核准',     btnCls: 'bg-green-600 hover:bg-green-700',  noteRequired: false },
    escalate:  { icon: '📋', title: '呈送總經理審核？',           btn: '呈總經理', btnCls: 'bg-orange-500 hover:bg-orange-600', noteRequired: false },
    reject:    { icon: '↩︎', title: '退回報價單？',              btn: '確認退回', btnCls: 'bg-red-500 hover:bg-red-600',      noteRequired: true  },
    resubmit:  { icon: '🔄', title: '重新送交行政審核？',         btn: '重新送審', btnCls: 'bg-blue-600 hover:bg-blue-700',    noteRequired: false },
  }
  const m = meta[action]

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onCancel}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="text-3xl mb-3">{m.icon}</div>
        <h3 className="text-lg font-bold text-stone-800 mb-1">{m.title}</h3>
        <p className="text-sm text-stone-500 mb-1">
          報價單號：<span className="font-semibold text-stone-700">{quote.quoteNumber}</span>
        </p>
        <p className="text-sm text-stone-500 mb-4">
          客戶：<span className="font-semibold text-stone-700">{quote.customerName}</span>
        </p>
        <div className="mb-5">
          <label className="block text-xs font-medium text-stone-500 mb-1">
            審核意見 {m.noteRequired ? <span className="text-red-500">*（退回必填）</span> : '（選填）'}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full border border-stone-300 rounded-xl px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            placeholder="填寫說明或意見…"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="button-secondary flex-1 rounded-xl">
            取消
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading || (m.noteRequired && !note.trim())}
            className={`flex-1 rounded-xl text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-60 ${m.btnCls}`}
          >
            {loading ? '處理中…' : m.btn}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────

function DeleteModal({
  quote,
  onConfirm,
  onCancel,
  loading,
}: {
  quote: Quote
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onCancel}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="text-3xl mb-3">🗑️</div>
        <h3 className="text-lg font-bold text-stone-800 mb-1">確認刪除報價單？</h3>
        <p className="text-sm text-stone-500 mb-1">
          報價單號：<span className="font-semibold text-stone-700">{quote.quoteNumber}</span>
        </p>
        <p className="text-sm text-stone-500 mb-5">
          客戶：<span className="font-semibold text-stone-700">{quote.customerName}</span>
        </p>
        <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 mb-5">
          此操作無法復原，相關品項也將一併刪除。
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="button-secondary flex-1 rounded-xl">
            取消
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-60">
            {loading ? '刪除中…' : '確認刪除'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function QuoteListContent() {
  const { data: session } = useSession()
  const user        = (session?.user as any) ?? {}
  const role        = user?.role        ?? ''
  const accountType = user?.accountType ?? ''

  const isAdmin = role === 'admin'
  const isStaff = accountType === '行政'
  const isGM    = accountType === '總經理'

  // What approval actions each role sees per-status
  function allowedActions(status: string): ApprovalAction[] {
    if (isAdmin) {
      if (status === '待行政審核')   return ['approve', 'escalate', 'reject']
      if (status === '待總經理審核') return ['approve', 'reject']
      if (status === '已退回')       return ['resubmit']
      return []
    }
    if (isStaff) {
      if (status === '待行政審核')   return ['approve', 'escalate', 'reject']
      if (status === '已退回')       return ['resubmit']
      return []
    }
    if (isGM) {
      if (status === '待行政審核')   return ['approve', 'reject']
      if (status === '待總經理審核') return ['approve', 'reject']
      return []
    }
    // Regular user: can resubmit their own rejected quotes
    if (status === '已退回') return ['resubmit']
    return []
  }

  const [quotes, setQuotes]           = useState<Quote[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [filterStatus, setFilterStatus] = useState(ALL)
  const [sortDir, setSortDir]         = useState<'desc' | 'asc'>('desc')

  // Delete
  const [deleteTarget,  setDeleteTarget]  = useState<Quote | null>(null)
  const [deleteVisible, setDeleteVisible] = useState(false)
  const [deleting,      setDeleting]      = useState(false)

  // Approval
  const [approvalTarget, setApprovalTarget]   = useState<{ quote: Quote; action: ApprovalAction } | null>(null)
  const [approvalVisible, setApprovalVisible] = useState(false)
  const [approving, setApproving]             = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────
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

  // ── Unique statuses (in appearance order) ─────────────────────
  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const q of quotes) {
      if (q.status && !seen.has(q.status)) { seen.add(q.status); list.push(q.status) }
    }
    return list
  }, [quotes])

  // ── Filtered + sorted ──────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = filterStatus === ALL ? quotes : quotes.filter((q) => q.status === filterStatus)
    if (sortDir === 'asc') list = [...list].reverse()
    return list
  }, [quotes, filterStatus, sortDir])

  // ── Delete handlers ────────────────────────────────────────────
  function openDelete(e: React.MouseEvent, quote: Quote) {
    e.preventDefault(); e.stopPropagation()
    setDeleteTarget(quote); setDeleteVisible(true)
  }
  function closeDelete() {
    setDeleteVisible(false)
    setTimeout(() => setDeleteTarget(null), 220)
  }
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/quotes/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('刪除失敗')
      setQuotes((prev) => prev.filter((q) => q.id !== deleteTarget.id))
      closeDelete()
    } catch {
      alert('刪除失敗，請稍後再試')
    } finally {
      setDeleting(false)
    }
  }

  // ── Approval handlers ──────────────────────────────────────────
  function openApproval(e: React.MouseEvent, quote: Quote, action: ApprovalAction) {
    e.preventDefault(); e.stopPropagation()
    setApprovalTarget({ quote, action }); setApprovalVisible(true)
  }
  function closeApproval() {
    setApprovalVisible(false)
    setTimeout(() => setApprovalTarget(null), 220)
  }
  async function confirmApproval(note: string) {
    if (!approvalTarget) return
    setApproving(true)
    try {
      const res = await fetch(`/api/quotes/${approvalTarget.quote.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: approvalTarget.action, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '操作失敗')
      // Update local state
      setQuotes((prev) =>
        prev.map((q) =>
          q.id === approvalTarget.quote.id
            ? { ...q, status: data.status as Quote['status'], approvalNote: note || q.approvalNote }
            : q
        )
      )
      closeApproval()
    } catch (err: any) {
      alert(err.message ?? '操作失敗，請稍後再試')
    } finally {
      setApproving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      <section className="panel p-6">
        {/* Header + controls */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-900">報價單列表</h3>
            {!loading && !error && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                {displayed.length} / {quotes.length} 張
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition"
            >
              <span>{sortDir === 'desc' ? '↓' : '↑'}</span>
              <span>{sortDir === 'desc' ? '由新到舊' : '由舊到新'}</span>
            </button>
            <Link href="/quote/new" className="button-primary rounded-full">
              ＋ 新增報價單
            </Link>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="mb-4 flex flex-wrap gap-2">
          {[ALL, ...statusOptions].map((s) => {
            const active = filterStatus === s
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {s}
                {s !== ALL && (
                  <span className={active ? 'ml-1 text-white/70' : 'ml-1 text-slate-400'}>
                    {quotes.filter((q) => q.status === s).length}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-400">
            載入報價單中…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-dashed border-red-200 bg-red-50 px-4 py-10 text-center text-sm text-red-500">
            {error}
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-400">
            {filterStatus === ALL ? '尚無報價單，點擊「新增報價單」開始建立。' : '沒有符合條件的報價單'}
          </div>
        ) : (
          <div className="space-y-2">
            {displayed.map((quote) => {
              const meta = STATUS_META[quote.status] ?? { label: quote.status, cls: 'bg-stone-100 text-stone-500 border-stone-200' }
              const actions = allowedActions(quote.status)
              const isApproved = quote.status === '已核准'

              return (
                <div
                  key={quote.id}
                  className="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-gradient-to-b from-[#fdfcfb] to-[#f8f6f3] px-5 py-4 transition hover:border-brand-200 hover:bg-white hover:shadow-sm"
                >
                  {/* Main row */}
                  <div className="flex items-center justify-between gap-4">
                    {/* Left info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-bold text-slate-700 shrink-0">
                          {quote.quoteNumber}
                        </span>
                      </div>
                      <div className="font-medium text-slate-800 truncate group-hover:text-brand-700 transition-colors">
                        {quote.customerName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                        {quote.createdAt  && <span>{formatDate(quote.createdAt)}</span>}
                        {quote.salesperson && <span>{quote.salesperson}</span>}
                        {quote.validUntil  && <span>有效至 {formatDate(quote.validUntil)}</span>}
                      </div>
                    </div>

                    {/* Right: amount + status + actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold text-slate-700 tabular-nums">
                        {formatMoney(quote.total)}
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {meta.label}
                      </span>

                      {/* Action buttons — visible on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/share/${quote.id}`}
                          target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                        >
                          預覽
                        </Link>
                        {isApproved ? (
                          <a
                            href={`/api/quotes/${quote.id}/pdf`}
                            target="_blank" rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                          >
                            PDF
                          </a>
                        ) : (
                          <span
                            title="需核准後才可產生 PDF"
                            className="rounded-lg bg-stone-50 text-stone-300 text-xs font-semibold px-2.5 py-1.5 whitespace-nowrap cursor-not-allowed select-none"
                          >
                            PDF
                          </span>
                        )}
                        <button
                          onClick={(e) => openDelete(e, quote)}
                          className="rounded-lg bg-red-50 hover:bg-red-100 text-red-500 text-xs font-semibold px-2.5 py-1.5 transition"
                        >
                          刪除
                        </button>
                      </div>

                      <span className="text-slate-300 group-hover:text-brand-400 transition-colors text-sm">›</span>
                    </div>
                  </div>

                  {/* Approval note banner */}
                  {quote.approvalNote && quote.status === '已退回' && (
                    <div className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
                      <span className="font-semibold">退回意見：</span>{quote.approvalNote}
                    </div>
                  )}

                  {/* Approval action buttons */}
                  {actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-400 self-center mr-1">簽核：</span>
                      {actions.includes('approve') && (
                        <button
                          onClick={(e) => openApproval(e, quote, 'approve')}
                          className="rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 transition"
                        >
                          ✓ 核准
                        </button>
                      )}
                      {actions.includes('escalate') && (
                        <button
                          onClick={(e) => openApproval(e, quote, 'escalate')}
                          className="rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 transition"
                        >
                          ↑ 呈總經理
                        </button>
                      )}
                      {actions.includes('reject') && (
                        <button
                          onClick={(e) => openApproval(e, quote, 'reject')}
                          className="rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold px-3 py-1.5 transition border border-red-200"
                        >
                          ✗ 退回
                        </button>
                      )}
                      {actions.includes('resubmit') && (
                        <button
                          onClick={(e) => openApproval(e, quote, 'resubmit')}
                          className="rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 transition border border-blue-200"
                        >
                          🔄 重新送審
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Approval modal */}
      <AnimatePresence>
        {approvalVisible && approvalTarget && (
          <ApprovalModal
            quote={approvalTarget.quote}
            action={approvalTarget.action}
            onConfirm={confirmApproval}
            onCancel={closeApproval}
            loading={approving}
          />
        )}
      </AnimatePresence>

      {/* Delete modal */}
      <AnimatePresence>
        {deleteVisible && deleteTarget && (
          <DeleteModal
            quote={deleteTarget}
            onConfirm={confirmDelete}
            onCancel={closeDelete}
            loading={deleting}
          />
        )}
      </AnimatePresence>
    </>
  )
}
