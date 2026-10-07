'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import type { Quote } from '@/types'
import { canEditQuote } from '@/lib/quote-status'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

/** 民國年短格式：2026-10-07 → 115/10/07（與報價單一致） */
function formatDate(d: string) {
  const m = (d ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[1]) - 1911}/${m[2]}/${m[3]}` : ''
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:          { label: '草稿',         cls: 'bg-stone-100 text-stone-500'  },
  待行政審核:    { label: '待行政審核',   cls: 'bg-amber-50 text-amber-700'   },
  待總經理審核:  { label: '待總經理審核', cls: 'bg-gold-50 text-gold-700'     },
  已核准:        { label: '已核准',       cls: 'bg-emerald-50 text-emerald-700' },
  已退回:        { label: '已退回',       cls: 'bg-red-50 text-red-600'       },
  已送出:        { label: '已送出',       cls: 'bg-brand-50 text-brand-700'   },
  已確認:        { label: '已確認',       cls: 'bg-brand-100 text-brand-700'  },
  已過期:        { label: '已過期',       cls: 'bg-stone-100 text-stone-400'  },
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
    approve:   { icon: '✅', title: '確認核准報價單？',           btn: '核准',     btnCls: 'bg-brand-500 hover:bg-brand-600 shadow-md shadow-brand-500/25',  noteRequired: false },
    escalate:  { icon: '📋', title: '呈送總經理審核？',           btn: '呈總經理', btnCls: 'bg-gold-600 hover:bg-gold-700', noteRequired: false },
    reject:    { icon: '↩︎', title: '退回報價單？',              btn: '確認退回', btnCls: 'bg-red-500 hover:bg-red-600',      noteRequired: true  },
    resubmit:  { icon: '🔄', title: '重新送交行政審核？',         btn: '重新送審', btnCls: 'bg-brand-500 hover:bg-brand-600',  noteRequired: false },
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
            className="input-soft resize-none"
            placeholder="填寫說明或意見…"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="button-secondary flex-1 py-2.5">
            取消
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading || (m.noteRequired && !note.trim())}
            className={`flex-1 rounded-full text-white text-sm font-semibold px-4 py-2.5 transition-all active:scale-95 disabled:opacity-60 ${m.btnCls}`}
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
          報價單與所有品項會一併移除（30 天內可由 Notion 垃圾桶救回）。
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="button-secondary flex-1 py-2.5">
            取消
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2.5 transition-all active:scale-95 disabled:opacity-60">
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

  // 簽核動作（核准／呈總經理／退回）。退回後的「修改並重新送審」改走編輯頁（PUT /api/quotes/[id] 的 submit），
  // 原本一般業務按「重新送審」會被 approve 的角色門擋下。
  function allowedActions(status: string): ApprovalAction[] {
    if (isAdmin || isGM) {
      if (status === '待行政審核' || status === '待總經理審核') return ['approve', 'reject']
      return []
    }
    if (isStaff && status === '待行政審核') return ['approve', 'escalate', 'reject']
    return []
  }

  const [quotes, setQuotes]           = useState<Quote[]>([])
  const [hasMore, setHasMore]         = useState(false)
  const [nextCursor, setNextCursor]   = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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

  const [copiedId, setCopiedId] = useState('')
  function copyShare(quote: Quote) {
    const url = quote.shareUrl || `${window.location.origin}/share/${quote.id.replace(/-/g, '')}`
    navigator.clipboard?.writeText(url).then(() => { setCopiedId(quote.id); setTimeout(() => setCopiedId(''), 1800) })
  }

  // ── Fetch ──────────────────────────────────────────────────────
  function loadQuotes() {
    setLoading(true)
    setError('')
    fetch('/api/quotes?limit=10')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '讀取失敗')
        if (data && typeof data === 'object' && Array.isArray(data.items)) {
          setQuotes(data.items)
          setHasMore(data.hasMore ?? false)
          setNextCursor(data.nextCursor ?? null)
        } else {
          setQuotes(Array.isArray(data) ? data : [])
          setHasMore(false)
          setNextCursor(null)
        }
      })
      .catch((err: Error) => setError(err.message || '讀取失敗'))
      .finally(() => setLoading(false))
  }

  function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    fetch(`/api/quotes?limit=10&cursor=${encodeURIComponent(nextCursor)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) return
        if (data && typeof data === 'object' && Array.isArray(data.items)) {
          setQuotes((prev) => [...prev, ...data.items])
          setHasMore(data.hasMore ?? false)
          setNextCursor(data.nextCursor ?? null)
        }
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
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
      <section className="card-soft p-4 sm:p-6">
        {/* Header + controls */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">報價工作</p>
              <h3 className="mt-1 text-lg font-bold text-stone-800">下一步：新增報價或選一筆繼續處理</h3>
            </div>
            {!loading && !error && (
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-500">
                {displayed.length} / {quotes.length} 張
              </span>
            )}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-stone-200 px-3 py-2 text-xs text-stone-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:scale-95 transition-all"
            >
              <span>{sortDir === 'desc' ? '↓' : '↑'}</span>
              <span>{sortDir === 'desc' ? '由新到舊' : '由舊到新'}</span>
            </button>
            <Link href="/quote/new" className="button-primary flex-1 rounded-full py-2.5 text-center sm:flex-none">
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
                    : 'border-stone-200 text-stone-500 hover:border-brand-300 hover:bg-brand-50'
                }`}
              >
                {s}
                {s !== ALL && (
                  <span className={active ? 'ml-1 text-white/70' : 'ml-1 text-stone-400'}>
                    {quotes.filter((q) => q.status === s).length}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50/60 px-4 py-10 text-center text-sm text-stone-400">
            載入報價單中…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-dashed border-red-200 bg-red-50 px-4 py-10 text-center text-sm text-red-500">
            {error}
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-8 text-center text-sm text-stone-400">
            {filterStatus === ALL ? '尚無報價單，點擊「新增報價單」開始建立。' : '沒有符合條件的報價單'}
          </div>
        ) : (
          <div className="space-y-2">
            {displayed.map((quote) => {
              const meta = STATUS_META[quote.status] ?? { label: quote.status, cls: 'bg-stone-100 text-stone-500' }
              const actions = allowedActions(quote.status)
              const id = quote.id.replace(/-/g, '')
              const isApproved = quote.status === '已核准'
              const editable = canEditQuote(quote.status)
              const chip = 'rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 whitespace-nowrap'
              const ghost = `${chip} text-stone-500 hover:bg-stone-100 hover:text-stone-700`

              return (
                <div key={quote.id} className="card-soft bg-white px-4 py-4 sm:px-5">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={editable ? `/quote/${id}/edit` : `/api/quotes/${id}/pdf`} target={editable ? undefined : '_blank'}
                          className="truncate font-semibold text-stone-800 hover:text-brand-700">
                          {quote.customerName || '（未填客戶）'}
                        </Link>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400">
                        <span className="font-mono text-stone-500">{quote.quoteNumber}</span>
                        <span>報價 {formatDate(quote.quoteDate || quote.createdAt)}</span>
                        {quote.validUntil && <span>有效至 {formatDate(quote.validUntil)}</span>}
                        {quote.salesperson && <span>{quote.salesperson}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-semibold tabular-nums text-stone-800">{formatMoney(quote.total)}</div>
                      <div className="text-[11px] text-stone-400">{quote.taxMode === '未稅' ? '未稅＋營業稅' : '含稅'}</div>
                    </div>
                  </div>

                  {quote.approvalNote && quote.status === '已退回' && (
                    <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                      <span className="font-semibold">退回意見：</span>{quote.approvalNote}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone-900/[0.06] pt-3">
                    {/* 主要動作：依狀態只給一個最該做的 */}
                    {quote.status === '草稿' && (
                      <Link href={`/quote/${id}/edit`} className="button-primary px-4 py-1.5 text-xs">編輯並送出</Link>
                    )}
                    {quote.status === '已退回' && (
                      <Link href={`/quote/${id}/edit`} className="button-primary px-4 py-1.5 text-xs">修改後重新送審</Link>
                    )}
                    {actions.includes('approve') && (
                      <button onClick={(e) => openApproval(e, quote, 'approve')} className="button-primary px-4 py-1.5 text-xs">✓ 核准</button>
                    )}
                    {actions.includes('escalate') && (
                      <button onClick={(e) => openApproval(e, quote, 'escalate')} className={`${chip} bg-gold-50 text-gold-700 hover:bg-gold-100`}>↑ 呈總經理</button>
                    )}
                    {actions.includes('reject') && (
                      <button onClick={(e) => openApproval(e, quote, 'reject')} className={`${chip} bg-red-50 text-red-600 hover:bg-red-100`}>退回</button>
                    )}
                    {isApproved && (
                      <>
                        <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer" className="button-primary px-4 py-1.5 text-xs">下載 PDF</a>
                        <button onClick={() => copyShare(quote)} className={`${chip} bg-brand-50 text-brand-700 hover:bg-brand-100`}>
                          {copiedId === quote.id ? '✓ 已複製' : '複製分享連結'}
                        </button>
                        <Link href={`/orders/new?fromQuote=${quote.id}`} className={`${chip} bg-brand-50 text-brand-700 hover:bg-brand-100`}>轉訂單</Link>
                      </>
                    )}

                    {/* 次要動作 */}
                    {!isApproved && (
                      <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer" className={ghost} title="內部預覽，帶浮水印">預覽 PDF</a>
                    )}
                    {editable && quote.status !== '草稿' && quote.status !== '已退回' && (
                      <Link href={`/quote/${id}/edit`} className={ghost}>編輯</Link>
                    )}
                    <Link href={`/quote/new?from=${id}`} className={ghost} title="以這張為底建立新報價單">複製</Link>
                    <button onClick={(e) => openDelete(e, quote)} className={`${chip} ml-auto text-stone-400 hover:bg-red-50 hover:text-red-600`}>刪除</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="button-secondary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? '載入中…' : '載入更多'}
            </button>
          </div>
        )}
        {!hasMore && quotes.length > 0 && (
          <p className="mt-3 text-center text-xs text-stone-300">
            已顯示全部 {quotes.length} 筆
          </p>
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
