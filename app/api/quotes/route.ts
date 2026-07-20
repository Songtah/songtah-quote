import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createQuote, listQuotes } from '@/lib/notion'
import type { QuoteItem } from '@/types'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { advanceCustomerDevStage } from '@/lib/notion/customers'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const p = req.nextUrl.searchParams
    const limit = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)
    const cursor = p.get('cursor') ?? undefined
    const result = await listQuotes({ limit, cursor })
    return NextResponse.json(result)
  } catch (err) {
    console.error('listQuotes error:', err)
    return NextResponse.json({ error: '無法取得報價單列表' }, { status: 500 })
  }
})

export const POST = withApiAuth({ module: 'quote', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const {
      customerName,
      customerId,
      companyTitle,
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
      companyTitle: companyTitle ?? '',
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

    if (customerId) {
      const user = session.user as any
      const canManageAll = user?.role === 'admin' || user?.accountType === '中央管理'
      await advanceCustomerDevStage(customerId, '報價中', {
        actorName: session.user?.name ?? '',
        canManageAll,
      }).catch((error) =>
        console.warn('quote stage advance error:', error)
      )
    }

    await logAuditEvent({
      module: 'quote',
      action: 'create',
      entityType: 'quote',
      entityId: quote.id,
      entityTitle: quote.quoteNumber,
      summary: `建立報價單：${quote.quoteNumber}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: quote,
      metadata: { itemCount: quoteItems.length },
    }).catch((error) => console.error('audit createQuote error:', error))

    return NextResponse.json(quote, { status: 201 })
  } catch (err) {
    console.error('createQuote error:', err)
    return NextResponse.json({ error: '建立報價單失敗' }, { status: 500 })
  }
})
