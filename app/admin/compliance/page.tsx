import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { ComplianceContent } from '@/components/ComplianceContent'
import { isCentralManagement, requireSession } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// 監測名單、證據與檢舉內容屬敏感資料，僅中央管理可見
export default async function CompliancePage() {
  const session = await requireSession()
  if (!isCentralManagement(session)) redirect('/dashboard')
  return (
    <AppShell title="法規監測" description="蒐集同業公開內容、比對醫療器材許可證、保存證據，並產出檢舉書草稿。" hidePhaseNote>
      <ComplianceContent />
    </AppShell>
  )
}
