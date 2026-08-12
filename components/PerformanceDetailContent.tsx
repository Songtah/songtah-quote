'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, PackageCheck } from 'lucide-react'

type OrderItem = {
  skuCode: string; skuName: string; quantity: number; unitPrice: number
  itemType?: 'normal' | 'gift' | 'sample'
}
type Order = {
  id: string; orderNumber: string; date: string; status: string
  totalAmount: number; customerName: string; items: OrderItem[]
}

export default function PerformanceDetailContent() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/dashboard/my-performance/orders').then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取訂單失敗')
      setOrders(json.orders ?? [])
    }).catch((caught) => setError(caught.message)).finally(() => setLoading(false))
  }, [])

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  if (loading) return <section className="card-soft p-6 text-center text-sm text-stone-400">載入訂單明細…</section>
  if (error) return <section className="card-soft p-5 text-sm text-red-600">{error}</section>

  return (
    <section className="card-soft overflow-hidden">
      <div className="border-b border-stone-900/[0.06] p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><PackageCheck className="size-5" /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">近 6 個月</p>
            <h2 className="mt-1 text-xl font-bold text-stone-800">{orders.length} 筆訂單</h2>
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="p-10 text-center text-sm text-stone-400">近 6 個月沒有訂單紀錄。</div>
      ) : (
        <div className="divide-y divide-stone-900/[0.06]">
          {orders.map((order) => {
            const isOpen = expanded.has(order.id)
            return (
              <div key={order.id}>
                <button
                  onClick={() => toggle(order.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-stone-50 active:scale-[0.99] sm:px-7"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-stone-800">{order.customerName || '（未填客戶）'}</p>
                    <p className="mt-0.5 text-xs text-stone-400">{order.orderNumber}・{order.date}・{order.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <p className="text-lg font-bold tabular-nums text-brand-700">NT$ {order.totalAmount.toLocaleString()}</p>
                    {isOpen ? <ChevronUp className="size-4 text-stone-400" /> : <ChevronDown className="size-4 text-stone-400" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="bg-stone-50/60 px-5 pb-4 sm:px-7">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-stone-400">
                          <th className="py-2 font-semibold">品名</th>
                          <th className="py-2 font-semibold">貨品碼</th>
                          <th className="py-2 text-right font-semibold">數量</th>
                          <th className="py-2 text-right font-semibold">單價</th>
                          <th className="py-2 text-right font-semibold">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item, index) => (
                          <tr key={`${item.skuCode}-${index}`} className="border-t border-stone-900/[0.05]">
                            <td className="py-2 pr-2 text-stone-700">
                              {item.skuName}
                              {item.itemType === 'gift' && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">贈品</span>}
                              {item.itemType === 'sample' && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">樣品</span>}
                            </td>
                            <td className="py-2 text-stone-400">{item.skuCode}</td>
                            <td className="py-2 text-right tabular-nums text-stone-700">{item.quantity}</td>
                            <td className="py-2 text-right tabular-nums text-stone-700">{item.unitPrice.toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums font-semibold text-stone-800">{(item.quantity * item.unitPrice).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
