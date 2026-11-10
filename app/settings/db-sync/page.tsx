import { AppShell } from '@/components/AppShell'
import DbSyncContent from '@/components/DbSyncContent'
import { requireAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function DbSyncPage() {
  await requireAdmin()
  return (
    <AppShell
      title="資料庫同步"
      description="客戶主檔：讀新資料庫、寫 Notion 後即時鏡像，每 15 分鐘增量、每晚全量校正。客情紀錄：2026-11-10 起只存新資料庫，Notion 已封存。"
      hidePhaseNote
    >
      <DbSyncContent />
    </AppShell>
  )
}
