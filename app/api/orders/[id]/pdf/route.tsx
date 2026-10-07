/** GET /api/orders/[id]/pdf — 訂購單 PDF（內部單據，需登入；草稿／已取消帶浮水印） */
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { withApiAuth } from '@/lib/api-auth'
import { getOrderById } from '@/lib/orders-notion'
import { OrderDocument } from '@/lib/order-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    const order = await getOrderById(params.id)
    if (!order) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
    const buffer = await renderToBuffer(<OrderDocument order={order} />)
    const filename = `訂購單_${order.orderNumber}_${order.customerName || ''}.pdf`
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}` },
    })
  } catch (err) {
    console.error('order PDF error:', err)
    return NextResponse.json({ error: 'PDF 產生失敗' }, { status: 500 })
  }
})
