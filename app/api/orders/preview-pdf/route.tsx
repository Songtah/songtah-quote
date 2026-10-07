/** POST /api/orders/preview-pdf — 編輯中（未存檔）的訂購單預覽 PDF；不寫入任何資料 */
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { withApiAuth } from '@/lib/api-auth'
import { OrderDocument } from '@/lib/order-pdf'
import type { Order } from '@/lib/orders-notion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')

export const POST = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest) => {
  try {
    const b = await req.json()
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((i: any, idx: number) => ({
      id: String(idx), skuCode: str(i.skuCode, 100), skuName: str(i.skuName), brand: str(i.brand, 200),
      seriesName: str(i.seriesName, 200), seriesId: '', quantity: Number(i.quantity) || 0,
      unitPrice: Number(i.unitPrice) || 0, note: str(i.note), itemType: i.itemType,
    }))
    const order: Order = {
      id: '', orderNumber: str(b.orderNumber, 50) || '（存檔後產生）', date: str(b.date, 10), salesperson: str(b.salesperson, 100),
      status: str(b.status, 10) || '草稿', note: str(b.note, 4000), items, totalAmount: 0, createdTime: '',
      customerId: '', customerName: str(b.customerName, 200), companyTitle: str(b.companyTitle, 200),
      customerAddress: str(b.customerAddress, 300), customerPhone: str(b.customerPhone, 100),
      contactPerson: str(b.contactPerson, 100), customerTaxId: str(b.customerTaxId, 20),
      promotionName: str(b.promotionName, 200), requestedDate: str(b.requestedDate, 10),
      paymentMethod: str(b.paymentMethod, 100), deliveryMethod: str(b.deliveryMethod, 100),
    }
    const buffer = await renderToBuffer(<OrderDocument order={order} />)
    return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('order preview pdf error:', err)
    return NextResponse.json({ error: 'PDF 預覽失敗' }, { status: 500 })
  }
})
