import { requireSession } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import OrdersContent from '@/components/OrdersContent'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  await requireSession()

  return (
    <AppShell title="訂貨單管理" description="建立與管理內部訂貨單" hidePhaseNote>
      <OrdersContent />
    </AppShell>
  )
}
