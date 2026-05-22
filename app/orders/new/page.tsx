import { requireSession } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import OrderForm from '@/components/OrderForm'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage() {
  await requireSession()

  return (
    <AppShell title="新增訂貨單" description="選擇品項建立訂貨單" hidePhaseNote>
      <OrderForm />
    </AppShell>
  )
}
