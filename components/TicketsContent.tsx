'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Ticket } from '@/types'
import TicketList from '@/components/TicketList'
import NewTicketModal from '@/components/NewTicketModal'

export default function TicketsContent() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  function loadTickets() {
    setLoading(true)
    setError('')
    fetch('/api/tickets?limit=10')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '載入失敗')
        if (data && typeof data === 'object' && Array.isArray(data.items)) {
          setTickets(data.items)
          setHasMore(data.hasMore ?? false)
          setNextCursor(data.nextCursor ?? null)
        } else {
          setTickets(Array.isArray(data) ? data : [])
          setHasMore(false)
          setNextCursor(null)
        }
      })
      .catch((err: Error) => setError(err.message || '無法取得工單資料'))
      .finally(() => setLoading(false))
  }

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    fetch(`/api/tickets?limit=10&cursor=${encodeURIComponent(nextCursor)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) return
        if (data && typeof data === 'object' && Array.isArray(data.items)) {
          setTickets((prev) => [...prev, ...data.items])
          setHasMore(data.hasMore ?? false)
          setNextCursor(data.nextCursor ?? null)
        }
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore])

  useEffect(() => { loadTickets() }, [])

  const open   = tickets.filter((t) => t.status !== '✅ 結案').length
  const closed = tickets.filter((t) => t.status === '✅ 結案').length

  return (
    <>
      {/* Stats */}
      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="panel p-5">
          <p className="eyebrow mb-2">總案件數</p>
          <p className="text-3xl font-black text-slate-900">
            {loading ? (
              <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" />
            ) : (
              <>{tickets.length}{hasMore && <span className="text-lg font-semibold text-slate-400">+</span>}</>
            )}
          </p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">處理中</p>
          <p className="text-3xl font-black text-blue-600">
            {loading ? (
              <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" />
            ) : (
              <>{open}{hasMore && <span className="text-lg font-semibold text-blue-300">+</span>}</>
            )}
          </p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">已結案</p>
          <p className="text-3xl font-black text-green-600">
            {loading ? (
              <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" />
            ) : (
              <>{closed}{hasMore && <span className="text-lg font-semibold text-green-300">+</span>}</>
            )}
          </p>
        </div>
      </section>

      {/* Actions */}
      <div className="mb-5 flex justify-end">
        <NewTicketModal onCreated={loadTickets} />
      </div>

      {/* List */}
      {loading ? (
        <div className="panel p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-100" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {error}
          <button onClick={loadTickets} className="ml-3 underline hover:no-underline">重試</button>
        </div>
      ) : (
        <TicketList tickets={tickets} />
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
      {!hasMore && tickets.length > 0 && (
        <p className="mt-3 text-center text-xs text-stone-300">
          已顯示全部 {tickets.length} 筆
        </p>
      )}
    </>
  )
}
