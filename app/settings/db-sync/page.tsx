import { AppShell } from '@/components/AppShell'
import DbSyncContent from '@/components/DbSyncContent'
import { requireAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function DbSyncPage() {
  await requireAdmin()
  return (
    <AppShell
      title="資料庫同步"
      description="客戶主檔與客情紀錄每晚從 Notion 鏡像到新資料庫。這裡只看筆數是否一致；系統仍以 Notion 為主，尚未切換。"
      hidePhaseNote
    >
      <DbSyncContent />
    </AppShell>
  )
}
