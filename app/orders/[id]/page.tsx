import { requireSession } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import { getOrderById } from '@/lib/orders-notion'
import { notFound } from 'next/navigation'
import OrderForm from '@/components/OrderForm'

export const dynamic = 'force-dynamic'

export default async function OrderDetailPage({
  params,
}: {
  params: { id: string }
}) {
  await requireSession()

  const order = await getOrderById(params.id)
  if (!order) notFound()

  return (
    <AppShell
      title={`訂貨單 ${order.orderNumber}`}
      description={`業務：${order.salesperson} · 日期：${order.date}`}
      hidePhaseNote
    >
      <OrderForm initialOrder={order} />
    </AppShell>
  )
}
