import { AppShell } from '@/components/AppShell'
import RegionStatsContent from '@/components/RegionStatsContent'
import { requireViewPermission } from '@/lib/permissions'
import { peekRegionStatsRows } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'

export default async function CustomerRegionsPage() {
  await requireViewPermission('crm')

  // 伺服器端只「讀快取」注入初始資料(絕不觸發全庫掃描,故頁面秒開)。
  // cache miss(極少:冷啟動/剛部署)時回 null,前端才自行補抓一次。
  const initial = await peekRegionStatsRows()

  return (
    <AppShell
      title="區域客戶儀表板"
      description="各鄉鎮市區的機構規模、公司既有客戶覆蓋與各業務轄區客戶數。"
    >
      <RegionStatsContent initialData={initial} />
    </AppShell>
  )
}
