'use client'

import { useEffect, useMemo, useState } from 'react'
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
  草稿:   { label: '草稿',   cls: 'bg-stone-100  text-stone-500  border-stone-200'  },
  已送出: { label: '已送出', cls: 'bg-blue-100   text-blue-700   border-blue-200'   },
  已確認: { label: '已確認', cls: 'bg-brand-100  text-brand-700  border-brand-200'  },
  已過期: { label: '已過期', cls: 'bg-red-100    text-red-600    border-red-200'    },
}

const ALL = '全部'

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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
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
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState(ALL)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null)
  const [deleteVisible, setDeleteVisible] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    fetch('/api/quotes')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '讀取失敗')
        setQuotes(Array.isArray(data) ? data : [])
      })
      .catch((err: Error) => setError(err.message || '讀取失敗'))
      .finally(() => setLoading(false))
  }, [])

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
    e.preventDefault()
    e.stopPropagation()
    setDeleteTarget(quote)
    setDeleteVisible(true)
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
            {/* Sort toggle */}
            <button
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition"
            >
              <span>{sortDir === 'desc' ? '↓' : '↑'}</span>
              <span>{sortDir === 'desc' ? '由新到舊' : '由舊到新'}</span>
            </button>

            {/* New quote */}
            <Link href="/quote/new" className="button-primary rounded-full">
              ＋ 新增報價單
            </Link>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="mb-4 flex flex-wrap gap-2">
          {[ALL, ...statusOptions].map((s) => {
            const active = filterStatus === s
            const meta = STATUS_META[s]
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
                {s !== ALL && meta ? (
                  <span className={`mr-1.5 inline-flex items-center gap-1 ${active ? '' : ''}`}>
                    {s}
                  </span>
                ) : s}
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
              return (
                <div
                  key={quote.id}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-[#fdfcfb] to-[#f8f6f3] px-5 py-4 transition hover:border-brand-200 hover:bg-white hover:shadow-sm"
                >
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
                      {quote.createdAt && <span>{formatDate(quote.createdAt)}</span>}
                      {quote.salesperson && <span>{quote.salesperson}</span>}
                      {quote.validUntil && (
                        <span>有效至 {formatDate(quote.validUntil)}</span>
                      )}
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
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                      >
                        預覽
                      </Link>
                      <a
                        href={`/api/quotes/${quote.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                      >
                        PDF
                      </a>
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
              )
            })}
          </div>
        )}
      </section>

      {/* Delete confirmation modal */}
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
