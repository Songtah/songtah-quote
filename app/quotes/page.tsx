import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import QuoteListContent from '@/components/QuoteListContent'

export const dynamic = 'force-dynamic'

export default async function QuotesPage() {
  await requireViewPermission('quote')

  return (
    <AppShell title="報價單管理" description="查看、新增與管理所有報價單" hidePhaseNote>
      <QuoteListContent />
    </AppShell>
  )
}
