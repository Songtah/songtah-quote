import { AppShell } from '@/components/AppShell'
import RegionStatsContent from '@/components/RegionStatsContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function CustomerRegionsPage() {
  await requireViewPermission('crm')

  return (
    <AppShell
      title="區域客戶儀表板"
      description="各鄉鎮市區的機構規模、公司既有客戶覆蓋與各業務轄區客戶數。"
    >
      <RegionStatsContent />
    </AppShell>
  )
}
