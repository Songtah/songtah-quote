import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import OrdersContent from '@/components/OrdersContent'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  await requireViewPermission('orders')

  return (
    <AppShell title="訂貨單管理" description="建立、追蹤訂貨單；送出後由行政確認受理到到貨。" hidePhaseNote>
      <OrdersContent />
    </AppShell>
  )
}
