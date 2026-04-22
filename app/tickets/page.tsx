import { AppShell } from '@/components/AppShell'
import { requireViewPermission } from '@/lib/permissions'
import TicketsContent from '@/components/TicketsContent'

export default async function TicketsPage() {
  await requireViewPermission('rma')

  return (
    <AppShell title="RMA 技術支援" description="維修案件、技術支援與設備追蹤。">
      <TicketsContent />
    </AppShell>
  )
}
