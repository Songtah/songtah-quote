/**
 * lib/quote-input.ts — 建立／修改報價單時，把前端傳來的 body 整理成乾淨的 QuoteInput。
 * 金額欄位（小計、總額）一律不採信前端，由 lib/quote-model 重算（CLAUDE.md 鐵則：寫入路徑伺服器端驗證）。
 * 單價屬業務議價、由報價審批把關，這裡只檢查是非負數。
 */
import type { QuoteItem } from '@/types'
import type { QuoteInput } from '@/lib/notion/quotes'
import { lineAmount, parseLayout, todayTW, addMonths } from '@/lib/quote-model'

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function parseQuoteInput(body: any): { input?: QuoteInput; error?: string } {
  const customerName = str(body?.customerName, 200)
  if (!customerName) return { error: '請填寫客戶名稱' }
  const rawItems: any[] = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) return { error: '請至少新增一個品項' }
  if (rawItems.length > 200) return { error: '品項最多 200 項' }

  const items: QuoteItem[] = []
  for (const [i, it] of Array.from(rawItems.entries())) {
    const name = str(it?.name, 500)
    if (!name) return { error: `第 ${i + 1} 項沒有品名` }
    const unitPrice = Number(it?.unitPrice)
    const quantity = Number(it?.quantity)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `第 ${i + 1} 項「${name}」單價不正確` }
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `第 ${i + 1} 項「${name}」數量需大於 0` }
    items.push({
      productId: str(it?.productId, 100),
      name,
      brand: str(it?.brand, 200),
      category: str(it?.category, 200),
      spec: str(it?.spec, 500),
      unit: str(it?.unit, 20),
      unitPrice: Math.round(unitPrice * 100) / 100,
      quantity: Math.round(quantity * 100) / 100,
      subtotal: lineAmount(unitPrice, quantity),
      note: str(it?.note, 1000),
      imageUrl: /^https?:\/\//.test(str(it?.imageUrl)) ? str(it?.imageUrl) : '',
      isCustom: Boolean(it?.isCustom),
    })
  }

  const quoteDate = isDate(body?.quoteDate) ? body.quoteDate : todayTW()
  const validUntil = isDate(body?.validUntil) ? body.validUntil : addMonths(quoteDate, 1)
  if (validUntil < quoteDate) return { error: '有效期限不能早於報價日期' }
  const discount = Math.max(0, Math.round(Number(body?.discount) || 0))

  return {
    input: {
      customerName,
      customerId: str(body?.customerId, 100),
      companyTitle: str(body?.companyTitle, 200),
      contactPerson: str(body?.contactPerson, 100),
      customerPhone: str(body?.customerPhone, 100),
      customerAddress: str(body?.customerAddress, 300),
      customerTaxId: str(body?.customerTaxId, 20),
      salesperson: str(body?.salesperson, 100),
      quoteDate,
      validUntil,
      paymentTerms: str(body?.paymentTerms, 200),
      deliveryTerms: str(body?.deliveryTerms, 200),
      taxMode: body?.taxMode === '未稅' ? '未稅' : '含稅',
      discount,
      layout: JSON.stringify(parseLayout(body?.layout)),
      note: str(body?.note, 4000),
      items,
    },
  }
}
