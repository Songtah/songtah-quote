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
import { redirect } from 'next/navigation'
import { computeQuoteTotals } from '@/lib/quote-model'
import type { OrderItem } from '@/lib/orders-notion'

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

  // 從已核准報價單「轉訂單」（2026-10-28 改版）：品項直接帶入，單價沿用報價核准價（議價已由報價審核把關）。
  // 有貨號（或品名完全對到目錄）的品項以目錄品項帶入；手打的規格／設備內容與已停售品轉成自訂品項，原文保留。
  // 整單折讓與稅別訂貨單沒有對應欄位，寫進備註請行政確認。一張報價單只轉一次（送出時伺服器再驗）。
  if (searchParams.fromQuote) {
    const quote = await getQuote(searchParams.fromQuote).catch(() => null)
    if (quote?.convertedOrder) redirect(`/orders/${quote.convertedOrder.id}`)
    if (quote && quote.status !== '已核准') {
      description = `報價單 ${quote.quoteNumber} 目前為「${quote.status}」，核准後才能轉訂單`
    } else if (quote) {
      const catalog = await getAvailableCatalog()
      const byCode = new Map(catalog.map((p) => [p.code, p]))
      const nameCount = new Map<string, number>()
      for (const p of catalog) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1)
      const byName = new Map(catalog.filter((p) => nameCount.get(p.name) === 1).map((p) => [p.name, p]))
      const custom: string[] = []
      const items: OrderItem[] = (quote.items ?? []).filter((it) => it.quantity > 0).map((it, idx) => {
        const p = (it.productId ? byCode.get(it.productId) : undefined) ?? (it.isCustom ? undefined : byName.get(it.name.trim()))
        const base = { id: `q-${idx}`, quantity: it.quantity, unitPrice: it.unitPrice, itemType: 'normal' as const }
        if (p) {
          return { ...base, skuCode: p.code, skuName: p.name, brand: p.brand || it.brand, seriesName: p.category, seriesId: '', note: it.note }
        }
        custom.push(it.name)
        const stopped = it.productId ? '（目錄已停售，請確認）' : ''
        return {
          ...base, skuCode: '', skuName: `${it.name}${stopped}`, brand: it.brand, seriesName: it.category, seriesId: '',
          note: [it.spec.replace(/\n+/g, '；'), it.note].filter(Boolean).join('；').slice(0, 500),
        }
      })
      const t = computeQuoteTotals({ items: quote.items ?? [], taxMode: quote.taxMode, discount: quote.discount })
      const checks = [
        t.discount > 0 ? `報價有整單折讓 NT$ ${t.discount.toLocaleString('zh-TW')}` : '',
        quote.taxMode === '未稅' ? `報價為未稅，另計營業稅 NT$ ${t.tax.toLocaleString('zh-TW')}` : '',
        custom.length ? `自訂品項（無貨號）：${custom.join('、')}` : '',
      ].filter(Boolean)
      prefill = {
        customerId:      quote.customerId,
        customerName:    quote.customerName,
        companyTitle:    quote.companyTitle,
        customerAddress: quote.customerAddress,
        customerPhone:   quote.customerPhone,
        contactPerson:   quote.contactPerson,
        customerTaxId:   quote.customerTaxId,
        items,
        sourceQuoteId:   quote.id,
        note: [`轉自報價單 ${quote.quoteNumber}（報價應付 NT$ ${t.total.toLocaleString('zh-TW')}）`,
          ...(checks.length ? [`請行政確認：${checks.join('；')}`] : [])].join('\n'),
      }
      description = `轉自報價單 ${quote.quoteNumber}：品項與報價核准價已帶入，可修改後再送出`
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
