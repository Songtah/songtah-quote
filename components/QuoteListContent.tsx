'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import type { Quote } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function formatDate(d: string) {
  if (!d) return '—'
  return d.slice(0, 10).replace(/-/g, '/')
}

const STATUS_META: Record<
  string,
  { label: string; cls: string }
> = {
  草稿:   { label: '草稿',   cls: 'bg-stone-100 text-stone-500' },
  已送出: { label: '已送出', cls: 'bg-blue-100  text-blue-700' },
  已確認: { label: '已確認', cls: 'bg-brand-100 text-brand-700' },
  已過期: { label: '已過期', cls: 'bg-red-100   text-red-600' },
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Panel */}
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
          <button
            onClick={onCancel}
            className="button-secondary flex-1 rounded-xl"
            disabled={loading}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-60"
          >
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
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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

  // ── Filter ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase()
    return quotes.filter((q) => {
      if (statusFilter && q.status !== statusFilter) return false
      if (!kw) return true
      return [q.quoteNumber, q.customerName, q.salesperson]
        .join(' ').toLowerCase().includes(kw)
    })
  }, [quotes, query, statusFilter])

  // ── Status counts ──────────────────────────────────────────────
  const statusCounts = useMemo(
    () =>
      quotes.reduce<Record<string, number>>((acc, q) => {
        acc[q.status] = (acc[q.status] ?? 0) + 1
        return acc
      }, {}),
    [quotes]
  )

  // ── Delete handlers ────────────────────────────────────────────
  function openDelete(quote: Quote) {
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

  // ── Input style ────────────────────────────────────────────────
  const inputCls =
    'w-full rounded-xl border border-brand-200/60 bg-cream-50/50 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-400 transition'

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status summary chips */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_META).map(([status, meta]) => (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  statusFilter === status
                    ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                    : 'border-brand-200/50 bg-white text-stone-500 hover:border-brand-300'
                }`}
              >
                <span className={`inline-block mr-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${meta.cls}`}>
                  {statusCounts[status] ?? 0}
                </span>
                {meta.label}
              </button>
            ))}
          </div>

          <Link href="/quote/new" className="button-primary rounded-full shrink-0">
            ＋ 新增報價單
          </Link>
        </div>

        {/* Search + filter */}
        <div className="panel p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋報價單號、客戶名稱、業務…"
              className={inputCls}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={inputCls + ' md:w-36'}
            >
              <option value="">全部狀態</option>
              {Object.entries(STATUS_META).map(([v, m]) => (
                <option key={v} value={v}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Record count */}
        {!loading && !error && quotes.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-stone-400 px-1">
            <span>
              共 <strong className="text-stone-700">{quotes.length}</strong> 張報價單
            </span>
            {filtered.length !== quotes.length && (
              <span>
                ・篩選後 <strong className="text-brand-600">{filtered.length}</strong> 張
              </span>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-brand-200/40 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm text-stone-400">載入報價單中…</div>
          ) : error ? (
            <div className="m-4 rounded-2xl bg-red-50 p-8 text-center text-sm text-red-500">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-stone-400">
              {query || statusFilter ? '沒有符合條件的報價單。' : '尚無報價單，點擊右上角「新增報價單」開始建立。'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-50 text-xs text-stone-500 border-b border-brand-100/40">
                  <tr>
                    <th className="px-4 py-3 text-left whitespace-nowrap">報價單號</th>
                    <th className="px-4 py-3 text-left">客戶</th>
                    <th className="px-4 py-3 text-left">業務</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">金額</th>
                    <th className="px-4 py-3 text-center">狀態</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">建立日期</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">有效期限</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100/30">
                  {filtered.map((quote) => {
                    const status = STATUS_META[quote.status] ?? { label: quote.status, cls: 'bg-stone-100 text-stone-500' }
                    return (
                      <tr key={quote.id} className="hover:bg-cream-50/60 transition-colors group">
                        {/* 報價單號 */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-semibold text-stone-700 text-xs tracking-wide">
                            {quote.quoteNumber}
                          </span>
                        </td>

                        {/* 客戶 */}
                        <td className="px-4 py-3 font-medium text-stone-800 min-w-[120px]">
                          {quote.customerName}
                        </td>

                        {/* 業務 */}
                        <td className="px-4 py-3 text-stone-500">
                          {quote.salesperson || '—'}
                        </td>

                        {/* 金額 */}
                        <td className="px-4 py-3 text-right font-semibold text-stone-800 whitespace-nowrap">
                          {formatMoney(quote.total)}
                        </td>

                        {/* 狀態 */}
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
                            {status.label}
                          </span>
                        </td>

                        {/* 建立日期 */}
                        <td className="px-4 py-3 text-stone-500 whitespace-nowrap">
                          {formatDate(quote.createdAt)}
                        </td>

                        {/* 有效期限 */}
                        <td className="px-4 py-3 text-stone-500 whitespace-nowrap">
                          {formatDate(quote.validUntil)}
                        </td>

                        {/* 操作 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                            <Link
                              href={`/share/${quote.id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="預覽報價單"
                              className="inline-flex items-center gap-1 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                            >
                              👁 預覽
                            </Link>
                            <a
                              href={`/api/quotes/${quote.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              title="下載 PDF"
                              className="inline-flex items-center gap-1 rounded-lg bg-stone-50 hover:bg-stone-100 text-stone-600 text-xs font-semibold px-2.5 py-1.5 transition whitespace-nowrap"
                            >
                              ↓ PDF
                            </a>
                            <button
                              onClick={() => openDelete(quote)}
                              title="刪除報價單"
                              className="inline-flex items-center rounded-lg bg-red-50 hover:bg-red-100 text-red-500 text-xs font-semibold px-2.5 py-1.5 transition"
                            >
                              刪除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
