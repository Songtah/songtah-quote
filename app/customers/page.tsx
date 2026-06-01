import { AppShell } from '@/components/AppShell'
import { CustomersContent } from '@/components/CustomersContent'
import { getDashboardSummary } from '@/lib/system-notion'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  await requireViewPermission('crm')

  const summary = await getDashboardSummary()

  return (
    <AppShell
      title="客戶管理"
      description="搜尋客戶、查看主檔資訊、設備清單與相關工單紀錄。"
    >
      <CustomersContent initialTotal={summary.customers.total} />
    </AppShell>
  )
}
