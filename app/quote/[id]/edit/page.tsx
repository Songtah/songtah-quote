import Link from 'next/link'
import { getServerSession } from 'next-auth'
import QuoteForm from '@/components/QuoteForm'
import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import { authOptions } from '@/lib/auth'
import { getQuote } from '@/lib/notion'
import { canEditQuote } from '@/lib/quote-status'

export const dynamic = 'force-dynamic'

export default async function EditQuotePage({ params }: { params: { id: string } }) {
  await requireViewPermission('quote')
  const session = await getServerSession(authOptions)
  const quote = await getQuote(params.id)

  if (!quote) {
    return (
      <AppShell title="修改報價單" description="" hidePhaseNote>
        <div className="card-soft rounded-3xl p-10 text-center text-sm text-stone-500">找不到這張報價單。<Link href="/quotes" className="ml-2 text-brand-700 underline">返回報價清單</Link></div>
      </AppShell>
    )
  }
  if (!canEditQuote(quote.status)) {
    return (
      <AppShell title="修改報價單" description="" hidePhaseNote>
        <div className="card-soft mx-auto max-w-lg rounded-3xl p-8 text-center">
          <p className="text-base font-semibold text-stone-800">{quote.quoteNumber} 目前為「{quote.status}」，不能修改</p>
          <p className="mt-2 text-sm text-stone-500">已核准的報價單價格已定格。需要調整時，可以複製成一張新的報價單，或請管理員先退回。</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href={`/quote/new?from=${quote.id.replace(/-/g, '')}`} className="button-primary px-5 py-2.5">複製成新報價單</Link>
            <Link href="/quotes" className="button-secondary px-5 py-2.5">返回報價清單</Link>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title={`修改報價單 ${quote.quoteNumber}`} description={`${quote.customerName}　·　${quote.status}`} hidePhaseNote>
      <QuoteForm mode="edit" initial={quote} defaultSalesperson={session?.user?.name ?? ''} />
    </AppShell>
  )
}
