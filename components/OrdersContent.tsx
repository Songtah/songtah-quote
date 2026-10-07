'use client'
/**
 * 訂貨單清單（2026-10-07 改版）
 * - 列出客戶與金額（原本只有單號／日期／業務，看不出是誰的單、多少錢）
 * - 狀態不再是人人可改的下拉：依 lib/order-status 只給「這個角色、這個狀態」能做的動作
 * - 只讀訂單摘要（?view=summary），不掃全部品項明細
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import type { Order } from '@/lib/orders-notion'
import { ORDER_STATUSES, ORDER_STATUS_STYLE, allowedOrderTransitions, canDeleteOrder, orderActorOf } from '@/lib/order-status'

const PAGE = 20

/** 2026-10-07 → 115/10/07 */
const roc = (d: string) => {
  const m = (d ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[1]) - 1911}/${m[2]}/${m[3]}` : ''
}

export default function OrdersContent() {
  const { data: session } = useSession()
  const actor = orderActorOf(session?.user)
  const me = session?.user?.name ?? ''

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/orders?view=summary')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '讀取失敗')
      setOrders(Array.isArray(data) ? data : [])
    } catch (e: any) { setError(e?.message ?? '讀取失敗') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { fetchOrders() }, [fetchOrders])

  async function changeStatus(order: Order, to: string, label: string) {
    if (to === '已取消' && !window.confirm(`確定要取消 ${order.orderNumber} 嗎？之後可由行政恢復為草稿。`)) return
    setBusyId(order.id); setError('')
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `${label}失敗`)
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: to } : o)))
    } catch (e: any) { setError(e?.message ?? `${label}失敗`) }
    finally { setBusyId(null) }
  }

  async function remove(order: Order) {
    setBusyId(order.id); setConfirmDeleteId(null); setError('')
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '刪除失敗')
      setOrders((prev) => prev.filter((o) => o.id !== order.id))
    } catch (e: any) { setError(e?.message ?? '刪除失敗') }
    finally { setBusyId(null) }
  }

  const base = useMemo(() => orders.filter((o) =>
    (!onlyMine || o.salesperson === me) &&
    (!q || [o.orderNumber, o.customerName, o.companyTitle, o.salesperson, o.note].some((v) => (v ?? '').includes(q)))
  ), [orders, onlyMine, me, q])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of base) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [base])
  const filtered = filterStatus ? base.filter((o) => o.status === filterStatus) : base
  const shown = filtered.slice(0, limit)
  const pending = actor === 'staff' ? (counts['已送出'] ?? 0) : (counts['草稿'] ?? 0)

  const chip = 'rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 whitespace-nowrap'

  return (
    <div className="space-y-4">
      {/* 頁首：主要動作＋待辦提示 */}
      <div className="card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="font-bold text-stone-800">
            {actor === 'staff'
              ? pending ? `有 ${pending} 張訂單待確認受理` : '目前沒有待確認的訂單'
              : pending ? `你有 ${pending} 張草稿還沒送出` : '建立訂貨單，送出後由行政確認'}
          </p>
          <p className="mt-0.5 text-xs text-stone-400">草稿 → 已送出 → 確認中 → 已到貨；到貨會同步把客戶標為「已成交」</p>
        </div>
        <Link href="/orders/new" className="button-primary px-5 py-2.5 text-center">＋ 新增訂貨單</Link>
      </div>

      {/* 篩選 */}
      <div className="card-soft space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder="搜尋單號、客戶、業務或備註"
            className="input-soft min-w-[200px] flex-1 rounded-full px-4 py-2" />
          {me && (
            <button onClick={() => setOnlyMine((v) => !v)}
              className={`${chip} ${onlyMine ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'}`}>只看我的</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['', ...ORDER_STATUSES].map((s) => (
            <button key={s || 'all'} onClick={() => { setFilterStatus(s); setLimit(PAGE) }}
              className={`${chip} ${filterStatus === s ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'}`}>
              {s || '全部'}<span className="ml-1 text-stone-400">{s ? counts[s] ?? 0 : base.length}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-16 text-center text-sm text-stone-400">載入中…</p>
      ) : filtered.length === 0 ? (
        <div className="card-soft py-14 text-center text-sm text-stone-400">
          <div className="mb-2 text-3xl">📋</div>
          {orders.length === 0 ? '尚無訂貨單，按「＋ 新增訂貨單」開始' : '沒有符合條件的訂貨單'}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((o) => {
            const transitions = allowedOrderTransitions(o.status, actor)
            const busy = busyId === o.id
            return (
              <li key={o.id} className="card-soft bg-white px-4 py-4 sm:px-5">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${o.id}`} className="truncate font-semibold text-stone-800 hover:text-brand-700">
                        {o.customerName || '（未填客戶）'}
                      </Link>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ORDER_STATUS_STYLE[o.status] ?? 'bg-stone-100 text-stone-600'}`}>{o.status}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400">
                      <span className="font-mono text-stone-500">{o.orderNumber}</span>
                      <span>訂購 {roc(o.date)}</span>
                      {o.requestedDate && <span>希望到貨 {roc(o.requestedDate)}</span>}
                      <span>{o.salesperson}</span>
                      {typeof o.itemCount === 'number' && <span>{o.itemCount} 項 · {o.totalQty ?? 0} 件</span>}
                    </div>
                    {o.note && <p className="mt-1 truncate text-xs text-stone-400">{o.note}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-semibold tabular-nums text-stone-800">NT$ {(o.totalAmount ?? 0).toLocaleString('zh-TW')}</div>
                    {o.promotionName && <div className="max-w-[160px] truncate text-[11px] text-stone-400">{o.promotionName}</div>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone-900/[0.06] pt-3">
                  {transitions.map((t) => (
                    <button key={t.action} disabled={busy} onClick={() => changeStatus(o, t.to, t.label)}
                      className={t.tone === 'primary' ? 'button-primary px-4 py-1.5 text-xs'
                        : t.tone === 'danger' ? `${chip} text-red-600 hover:bg-red-50 disabled:opacity-50`
                        : `${chip} bg-stone-100 text-stone-600 hover:bg-stone-200 disabled:opacity-50`}>
                      {t.label}
                    </button>
                  ))}
                  <Link href={`/orders/${o.id}`} className={`${chip} text-stone-500 hover:bg-stone-100`}>
                    {(actor === 'staff' && o.status !== '已取消') || o.status === '草稿' ? '開啟編輯' : '查看'}
                  </Link>
                  <a href={`/api/orders/${o.id}/pdf`} target="_blank" rel="noreferrer" className={`${chip} text-stone-500 hover:bg-stone-100`}>PDF</a>
                  <Link href={`/orders/new?from=${o.id}`} className={`${chip} text-stone-500 hover:bg-stone-100`} title="以這張為底建立新訂單，單價更新為目前售價">再訂一次</Link>
                  {canDeleteOrder(o.status, actor) && (
                    confirmDeleteId === o.id ? (
                      <span className="ml-auto flex items-center gap-2 text-xs">
                        <span className="text-stone-500">確定刪除？</span>
                        <button onClick={() => remove(o)} disabled={busy} className="font-semibold text-red-600 disabled:opacity-50">{busy ? '刪除中…' : '刪除'}</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-stone-400">取消</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(o.id)} disabled={busy} className={`${chip} ml-auto text-stone-400 hover:bg-red-50 hover:text-red-600`}>刪除</button>
                    )
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {filtered.length > limit ? (
        <button onClick={() => setLimit((v) => v + PAGE)} className="button-secondary mx-auto block px-5 py-2">顯示更多（還有 {filtered.length - limit} 張）</button>
      ) : filtered.length > 0 ? (
        <p className="text-center text-xs text-stone-300">已顯示全部 {filtered.length} 張</p>
      ) : null}
    </div>
  )
}
