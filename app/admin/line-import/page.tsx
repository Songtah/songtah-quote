import { AppShell } from '@/components/AppShell'
import { requireAdmin } from '@/lib/permissions'
import { LineImportContent } from '@/components/LineImportContent'

export const dynamic = 'force-dynamic'

export default async function LineImportPage() {
  await requireAdmin()

  return (
    <AppShell
      title="LINE 客情紀錄匯入"
      description="上傳 LINE 群組聊天記錄 .txt，AI 自動識別並匯入客情紀錄。"
    >
      <LineImportContent canImportForOthers />
    </AppShell>
  )
}
