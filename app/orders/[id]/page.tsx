import { requireSession } from '@/lib/permissions'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role as string | undefined
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  // admin 和 env 帳號（permissions 為 undefined）預設可編輯；否則看 orders.edit
  const canEdit = role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)

  const order = await getOrderById(params.id)
  if (!order) notFound()

  return (
    <AppShell
      title={`訂貨單 ${order.orderNumber}`}
      description={`業務：${order.salesperson} · 日期：${order.date}`}
      hidePhaseNote
    >
      <OrderForm initialOrder={order} canEdit={canEdit} />
    </AppShell>
  )
}
