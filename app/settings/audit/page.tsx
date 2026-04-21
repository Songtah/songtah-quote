import { AppShell } from '@/components/AppShell'
import AuditLogsContent from '@/components/AuditLogsContent'
import { requireAdmin } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  await requireAdmin()

  return (
    <AppShell
      title="操作紀錄"
      description="提供中央管理查詢系統異動軌跡，快速追蹤誰在什麼時間對哪筆資料做了什麼操作。"
      hidePhaseNote
    >
      <AuditLogsContent />
    </AppShell>
  )
}
