import { requireSession } from '@/lib/permissions'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { getOrderById } from '@/lib/orders-notion'
import { notFound } from 'next/navigation'
import OrderForm from '@/components/OrderForm'
import { orderActorOf, canEditOrderContent } from '@/lib/order-status'
import { rocDate } from '@/lib/quote-model'

export const dynamic = 'force-dynamic'

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  await requireSession()
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  const hasEditPerm = user?.role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)
  const actor = orderActorOf(user)

  const order = await getOrderById(params.id)
  if (!order) notFound()

  // 內容可改：業務只限草稿；行政可改未取消的單（規則見 lib/order-status）
  const canEdit = hasEditPerm && canEditOrderContent(order.status, actor)
  const lockedNote = !hasEditPerm
    ? undefined
    : !canEdit
      ? order.status === '已取消'
        ? '訂單已取消，需由行政恢復為草稿才能修改'
        : `訂單已${order.status}，僅行政帳號可修改；需要調整請按右側「撤回修改」或聯絡行政`
      : undefined

  return (
    <AppShell
      title={`訂貨單 ${order.orderNumber}`}
      description={`${order.customerName || '未填客戶'}　·　${order.salesperson}　·　${rocDate(order.date)}`}
      hidePhaseNote
    >
      <OrderForm initialOrder={order} canEdit={canEdit} lockedNote={lockedNote} actor={hasEditPerm ? actor : 'editor'} />
    </AppShell>
  )
}
