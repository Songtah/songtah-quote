import { getServerSession } from 'next-auth'
import QuoteForm from '@/components/QuoteForm'
import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import { authOptions } from '@/lib/auth'
import { getQuote } from '@/lib/notion'

export const dynamic = 'force-dynamic'

/** ?from=<報價單id>：以既有報價單為底複製一張新的（日期重新起算、狀態從頭開始） */
export default async function NewQuotePage({ searchParams }: { searchParams: { from?: string } }) {
  await requireViewPermission('quote')
  const session = await getServerSession(authOptions)
  const source = searchParams.from ? await getQuote(searchParams.from) : null

  return (
    <AppShell
      title={source ? '複製報價單' : '新增報價單'}
      description={source ? `以 ${source.quoteNumber}（${source.customerName}）為底，存檔後會產生新的單號。` : ''}
      hidePhaseNote
    >
      <QuoteForm mode="create" initial={source} defaultSalesperson={session?.user?.name ?? ''} />
    </AppShell>
  )
}
