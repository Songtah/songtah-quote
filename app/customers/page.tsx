import { AppShell } from '@/components/AppShell'
import { CustomersContent } from '@/components/CustomersContent'
import { getAllSystemCustomers, getCustomerFilterOptions } from '@/lib/system-notion'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  await requireViewPermission('crm')

  // 在 Server 端平行拿資料，使用者打開頁面時資料已就緒
  const [customers, options] = await Promise.all([
    getAllSystemCustomers().catch(() => []),
    getCustomerFilterOptions().catch(() => ({
      cities: [], districtsByCity: {}, salespersons: [], types: [],
    })),
  ])

  return (
    <AppShell
      title="客戶管理"
      description="搜尋客戶、查看主檔資訊、設備清單與相關工單紀錄。"
    >
      <CustomersContent initialCustomers={customers} initialOptions={options} />
    </AppShell>
  )
}
