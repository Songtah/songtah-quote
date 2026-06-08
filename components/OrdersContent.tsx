'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Order } from '@/lib/orders-notion'

const STATUS_COLOR: Record<string, string> = {
  草稿:   'bg-gray-100 text-gray-600',
  已送出: 'bg-blue-100 text-blue-700',
  確認中: 'bg-yellow-100 text-yellow-700',
  已到貨: 'bg-green-100 text-green-700',
  已取消: 'bg-red-100 text-red-600',
}

const STATUS_OPTIONS = ['草稿', '已送出', '確認中', '已到貨', '已取消']

const DISPLAY_STEP = 10

export default function OrdersContent() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_STEP)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const data = await res.json()
        setOrders(data)
      }
    } catch (e) {
      console.error('fetchOrders error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setConfirmDeleteId(null)
    try {
      await fetch(`/api/orders/${id}`, { method: 'DELETE' })
      setOrders((prev) => prev.filter((o) => o.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const handleStatusChange = async (id: string, newStatus: string) => {
    setUpdatingId(id)
    try {
      await fetch(`/api/orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o))
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const filtered = filterStatus
    ? orders.filter((o) => o.status === filterStatus)
    : orders

  const displayed = filtered.slice(0, displayLimit)
  const hasDisplayMore = filtered.length > displayLimit

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">全部狀態</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="text-sm text-gray-400">
            共 {filtered.length} 筆
            {hasDisplayMore && <span className="ml-1 text-amber-500">（顯示前 {displayLimit} 筆）</span>}
          </span>
        </div>
        <Link
          href="/orders/new"
          className="button-primary px-4 py-2 text-sm rounded"
        >
          + 新增訂貨單
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center text-gray-400 py-16">載入中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-sm">尚無訂貨單，點擊右上角新增</div>
        </div>
      ) : (
        <>
          {/* ── Mobile cards (< md) ── */}
          <div className="md:hidden space-y-3">
            {displayed.map((order) => (
              <div key={order.id} className="bg-white border rounded-lg p-4 space-y-3">
                {/* Top row: order number + status */}
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-mono text-blue-600 font-semibold text-sm"
                  >
                    {order.orderNumber || '—'}
                  </Link>
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(order.id, e.target.value)}
                    disabled={updatingId === order.id}
                    className={`text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer focus:outline-none ${STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {/* Meta info */}
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>📅 {order.date}</span>
                  <span>👤 {order.salesperson}</span>
                  {order.items.length > 0 && (
                    <span>📦 {order.items.length} 種 · {order.items.reduce((a, it) => a + it.quantity, 0)} 件</span>
                  )}
                </div>
                {order.note && (
                  <p className="text-xs text-gray-400 truncate">備註：{order.note}</p>
                )}
                {/* Actions */}
                <div className="flex items-center gap-3 pt-1 border-t">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-sm text-blue-500 font-medium"
                  >
                    查看 ›
                  </Link>
                  {confirmDeleteId === order.id ? (
                    <span className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-gray-500">確定刪除？</span>
                      <button
                        onClick={() => handleDelete(order.id)}
                        disabled={deletingId === order.id}
                        className="text-xs text-red-600 font-semibold disabled:opacity-50"
                      >
                        {deletingId === order.id ? '刪除中…' : '確定'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-gray-400"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(order.id)}
                      disabled={deletingId === order.id}
                      className="text-xs text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50 ml-auto"
                    >
                      刪除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop table (md+) ── */}
          <div className="hidden md:block bg-white border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide border-b">
                    <th className="px-4 py-3 text-left">訂單編號</th>
                    <th className="px-4 py-3 text-left">日期</th>
                    <th className="px-4 py-3 text-left">業務</th>
                    <th className="px-4 py-3 text-left">品項</th>
                    <th className="px-4 py-3 text-left">備註</th>
                    <th className="px-4 py-3 text-center">狀態</th>
                    <th className="px-4 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {displayed.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-mono text-blue-600 hover:underline font-medium"
                        >
                          {order.orderNumber || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{order.date}</td>
                      <td className="px-4 py-3 text-gray-700">{order.salesperson}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {order.items.length > 0 ? (
                          <span>
                            {order.items.length} 種・
                            {order.items.reduce((acc, it) => acc + it.quantity, 0)} 件
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{order.note || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <select
                          value={order.status}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          disabled={updatingId === order.id}
                          className={`text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer focus:outline-none ${STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-3">
                          <Link
                            href={`/orders/${order.id}`}
                            className="text-blue-500 hover:text-blue-700 text-xs"
                          >
                            查看 ›
                          </Link>
                          {confirmDeleteId === order.id ? (
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">確定刪除？</span>
                              <button
                                onClick={() => handleDelete(order.id)}
                                disabled={deletingId === order.id}
                                className="text-xs text-red-600 font-semibold hover:text-red-800 disabled:opacity-50"
                              >
                                {deletingId === order.id ? '刪除中…' : '確定'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                取消
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(order.id)}
                              disabled={deletingId === order.id}
                              className="text-xs text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              刪除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Load more */}
          {hasDisplayMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setDisplayLimit((prev) => prev + DISPLAY_STEP)}
                className="button-secondary px-5 py-2 text-sm"
              >
                載入更多
              </button>
            </div>
          )}
          {!hasDisplayMore && displayed.length > 0 && (
            <p className="mt-3 text-center text-xs text-stone-300">
              已顯示全部 {filtered.length} 筆
            </p>
          )}
        </>
      )}
    </div>
  )
}
