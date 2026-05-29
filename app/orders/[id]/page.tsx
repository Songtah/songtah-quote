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
  const role        = user?.role        as string | undefined
  const accountType = user?.accountType as string | undefined
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined

  // 行政帳號（中央管理 / 行政 / admin）不受訂單狀態限制，業務帳號只能編輯草稿
  const isAdmin    = role === 'admin' || accountType === '行政' || accountType === '中央管理'
  const hasEditPerm = role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)

  const order = await getOrderById(params.id)
  if (!order) notFound()

  const canEdit = hasEditPerm && (isAdmin || order.status === '草稿')

  // 只在「有權限但被狀態鎖住」時才顯示鎖定原因；純無權限帳號走原本訊息
  const lockedNote = (hasEditPerm && !isAdmin && order.status !== '草稿')
    ? `訂單已${order.status}，僅行政帳號可修改`
    : undefined

  return (
    <AppShell
      title={`訂貨單 ${order.orderNumber}`}
      description={`業務：${order.salesperson} · 日期：${order.date}`}
      hidePhaseNote
    >
      <OrderForm initialOrder={order} canEdit={canEdit} lockedNote={lockedNote} />
    </AppShell>
  )
}
