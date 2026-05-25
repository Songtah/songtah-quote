import { requireSession } from '@/lib/permissions'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import OrderForm from '@/components/OrderForm'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage() {
  await requireSession()
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role as string | undefined
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  const canEdit = role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)

  return (
    <AppShell title="新增訂貨單" description="選擇品項建立訂貨單" hidePhaseNote>
      <OrderForm canEdit={canEdit} />
    </AppShell>
  )
}
