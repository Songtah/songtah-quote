import QuoteForm from '@/components/QuoteForm'
import { getProducts } from '@/lib/notion'
import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage() {
  await requireViewPermission('quote')

  const products = await getProducts()

  return (
    <AppShell title="新增報價單" description="" hidePhaseNote>
      <QuoteForm products={products} />
    </AppShell>
  )
}
