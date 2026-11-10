import { AppShell } from '@/components/AppShell'
import DbSyncContent from '@/components/DbSyncContent'
import { requireAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function DbSyncPage() {
  await requireAdmin()
  return (
    <AppShell
      title="資料庫同步"
      description="客戶主檔與客情紀錄自 2026-11-10 起只存新資料庫，Notion 已封存、同步已停用。這裡保留搬遷期間的同步紀錄。"
      hidePhaseNote
    >
      <DbSyncContent />
    </AppShell>
  )
}
