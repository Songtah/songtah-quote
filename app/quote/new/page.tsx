import { getServerSession } from 'next-auth'
import QuoteForm from '@/components/QuoteForm'
import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import { authOptions } from '@/lib/auth'
import { getQuote } from '@/lib/notion'
import { getSystemCustomerById } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'

/** ?from=<報價單id>：以既有報價單為底複製一張新的（日期重新起算、狀態從頭開始） */
export default async function NewQuotePage({ searchParams }: { searchParams: { from?: string; customerId?: string } }) {
  await requireViewPermission('quote')
  const session = await getServerSession(authOptions)
  const source = searchParams.from ? await getQuote(searchParams.from) : null
  // ?customerId=<客戶id>：從客戶頁進來，客戶資料直接帶入，不用再搜尋一次
  const c = !source && searchParams.customerId ? await getSystemCustomerById(searchParams.customerId).catch(() => null) : null
  const prefillCustomer = c ? { id: c.id, name: c.name, phone: c.phone, address: c.address, taxId: c.taxId } : undefined

  return (
    <AppShell
      title={source ? '複製報價單' : '新增報價單'}
      description={source ? `以 ${source.quoteNumber}（${source.customerName}）為底，存檔後會產生新的單號。` : ''}
      hidePhaseNote
    >
      <QuoteForm mode="create" initial={source} defaultSalesperson={session?.user?.name ?? ''} prefillCustomer={prefillCustomer} />
    </AppShell>
  )
}
