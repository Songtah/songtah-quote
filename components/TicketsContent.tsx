'use client'

import { useEffect, useState } from 'react'
import type { Ticket } from '@/types'
import TicketList from '@/components/TicketList'
import NewTicketModal from '@/components/NewTicketModal'

export default function TicketsContent() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function loadTickets() {
    setLoading(true)
    setError('')
    fetch('/api/tickets')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? '載入失敗')
        setTickets(Array.isArray(data) ? data : [])
      })
      .catch((err: Error) => setError(err.message || '無法取得工單資料'))
      .finally(() => setLoading(false))
  }

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
            {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" /> : tickets.length}
          </p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">處理中</p>
          <p className="text-3xl font-black text-blue-600">
            {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" /> : open}
          </p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">已結案</p>
          <p className="text-3xl font-black text-green-600">
            {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-stone-200" /> : closed}
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
    </>
  )
}
