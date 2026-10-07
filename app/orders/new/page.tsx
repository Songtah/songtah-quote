import type { ComponentProps } from 'react'
import { requireSession } from '@/lib/permissions'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import OrderForm from '@/components/OrderForm'
import { getQuote } from '@/lib/notion'
import { getOrderById } from '@/lib/orders-notion'
import { getAvailableCatalog } from '@/lib/products-availability'
import { orderActorOf } from '@/lib/order-status'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: { fromQuote?: string; from?: string }
}) {
  await requireSession()
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role as string | undefined
  const permissions = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  const canEdit = role === 'admin' || !permissions || (permissions?.orders?.edit ?? false)

  let prefill: ComponentProps<typeof OrderForm>['prefill']
  let description = '選擇品項建立訂貨單'

  // 從已核准報價單「轉訂單」：只帶客戶資料與品項清單當備註參考，
  // 品項仍須經訂貨頁選品器重新加入(才能走完整促銷/庫存驗證)，不直接寫入訂單品項。
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
        contactPerson:   quote.contactPerson,
        customerTaxId:   quote.customerTaxId,
        note: `轉自報價單 ${quote.quoteNumber}，原報價品項供對照(請至下方重新選品，以套用正確促銷/庫存驗證)：\n${itemsNote}`,
      }
      description = `轉自報價單 ${quote.quoteNumber}`
    }
  }

  // 「再訂一次」：以既有訂單為底。單價一律改用「現在」的有效售價（價格快照鐵則：新單不沿用舊價），
  // 已停售／中央停用的品項與贈品／樣品不帶入（贈品要依促銷重新取得），自訂品項保留原內容。
  if (searchParams.from) {
    const source = await getOrderById(searchParams.from).catch(() => null)
    if (source) {
      const catalog = new Map((await getAvailableCatalog()).map((p) => [p.code, p]))
      const dropped: string[] = []
      const items = source.items.flatMap((it, idx) => {
        if (it.itemType === 'gift' || it.itemType === 'sample') return []
        if (!it.skuCode) return [{ ...it, id: `re-${idx}` }]
        const p = catalog.get(it.skuCode)
        if (!p) { dropped.push(it.skuName); return [] }
        const price = (p as any).salePrice ?? p.price ?? 0
        return [{ ...it, id: `re-${idx}`, unitPrice: price, baseUnitPrice: undefined }]
      })
      prefill = {
        customerId: source.customerId, customerName: source.customerName, companyTitle: source.companyTitle,
        customerAddress: source.customerAddress, customerPhone: source.customerPhone,
        contactPerson: source.contactPerson, customerTaxId: source.customerTaxId,
        paymentMethod: source.paymentMethod, deliveryMethod: source.deliveryMethod,
        note: dropped.length ? `再訂自 ${source.orderNumber}；以下品項已停售未帶入：${dropped.join('、')}` : `再訂自 ${source.orderNumber}`,
        items,
      }
      description = `再訂一次：以 ${source.orderNumber}（${source.customerName || '未填客戶'}）為底，單價已更新為目前售價`
    }
  }

  return (
    <AppShell title="新增訂貨單" description={description} hidePhaseNote>
      <OrderForm canEdit={canEdit} prefill={prefill} actor={orderActorOf(user)} defaultSalesperson={session?.user?.name ?? ''} />
    </AppShell>
  )
}
