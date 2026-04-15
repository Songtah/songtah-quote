import { AppShell } from '@/components/AppShell'
import VisitsContent from '@/components/VisitsContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function BdPage() {
  await requireViewPermission('bd')

  return (
    <AppShell
      title="BD 客情紀錄"
      description="記錄每日客戶拜訪情況，掌握各地區業務動態。"
    >
      <VisitsContent />
    </AppShell>
  )
}
