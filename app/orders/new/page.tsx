import type { ComponentProps } from 'react'
import { requireSession } from '@/lib/permissions'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import OrderForm from '@/components/OrderForm'
import { getQuote } from '@/lib/notion'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: { fromQuote?: string }
}) {
  await requireSession()
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role as string | undefined
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  const canEdit = role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)

  // 從已核准報價單「轉訂單」：只帶客戶資料與品項清單當備註參考，
  // 品項仍須經訂貨頁選品器重新加入(才能走完整促銷/庫存驗證)，不直接寫入訂單品項。
  let prefill: ComponentProps<typeof OrderForm>['prefill']
  if (searchParams.fromQuote) {
    const quote = await getQuote(searchParams.fromQuote).catch(() => null)
    if (quote) {
      const itemsNote = (quote.items ?? [])
        .map((it) => `・${it.name}　${it.spec ? `(${it.spec})　` : ''}x${it.quantity}`)
        .join('\n')
      prefill = {
        customerId:      quote.customerId,
        customerName:    quote.customerName,
        companyTitle:    quote.companyTitle,
        customerAddress: quote.customerAddress,
        customerPhone:   quote.customerPhone,
        customerTaxId:   quote.customerTaxId,
        note: `轉自報價單 ${quote.quoteNumber}，原報價品項供對照(請至下方重新選品，以套用正確促銷/庫存驗證)：\n${itemsNote}`,
      }
    }
  }

  return (
    <AppShell title="新增訂貨單" description="選擇品項建立訂貨單" hidePhaseNote>
      <OrderForm canEdit={canEdit} prefill={prefill} />
    </AppShell>
  )
}
