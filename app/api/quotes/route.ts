import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createQuote, listQuotes } from '@/lib/notion'
import type { QuoteItem } from '@/types'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const quotes = await listQuotes()
    return NextResponse.json(quotes)
  } catch (err) {
    console.error('listQuotes error:', err)
    return NextResponse.json({ error: '無法取得報價單列表' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      customerName,
      customerId,
      customerPhone,
      customerAddress,
      customerTaxId,
      salesperson,
      validUntil,
      paymentTerms,
      note,
      items,
    } = body

    if (!customerName || !items?.length) {
      return NextResponse.json({ error: '客戶名稱與品項為必填' }, { status: 400 })
    }

    const quoteItems: QuoteItem[] = items.map((item: any) => ({
      ...item,
      subtotal: item.unitPrice * item.quantity,
    }))
    const total = quoteItems.reduce((sum, i) => sum + i.subtotal, 0)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const quote = await createQuote({
      customerName,
      customerId: customerId ?? '',
      customerPhone: customerPhone ?? '',
      customerAddress: customerAddress ?? '',
      customerTaxId: customerTaxId ?? '',
      salesperson: salesperson ?? '',
      validUntil: validUntil ?? '',
      paymentTerms: paymentTerms ?? '',
      note: note ?? '',
      total,
      items: quoteItems,
      appUrl,
    })

    return NextResponse.json(quote, { status: 201 })
  } catch (err) {
    console.error('createQuote error:', err)
    return NextResponse.json({ error: '建立報價單失敗' }, { status: 500 })
  }
}
