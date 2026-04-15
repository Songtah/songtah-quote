import { AppShell } from '@/components/AppShell'
import AccountsContent from '@/components/AccountsContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  await requireViewPermission('accounts')

  return (
    <AppShell
      title="帳號與權限"
      description="管理系統帳號、設定各頁面的檢視與編輯權限。"
      hidePhaseNote
    >
      <AccountsContent />
    </AppShell>
  )
}
