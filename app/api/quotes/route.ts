import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createQuote, listQuotes } from '@/lib/notion'
import { parseQuoteInput } from '@/lib/quote-input'
import { QUOTE_TRANSITIONS } from '@/lib/quote-status'
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
    const { input, error } = parseQuoteInput(body)
    if (!input) return NextResponse.json({ error }, { status: 400 })
    // submit=false → 存成草稿（之後可再修改、送出）；預設直接送行政審核（維持既有流程）
    const status = body?.submit === false ? '草稿' : QUOTE_TRANSITIONS['草稿'].submit.to as '待行政審核'

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const quote = await createQuote({ ...input, appUrl, status })

    if (input.customerId) {
      const user = session.user as any
      const canManageAll = user?.role === 'admin' || user?.accountType === '中央管理'
      await advanceCustomerDevStage(input.customerId, '報價中', {
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
      summary: `建立報價單：${quote.quoteNumber}（${status}）`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: quote,
      metadata: { itemCount: input.items.length },
    }).catch((error) => console.error('audit createQuote error:', error))

    return NextResponse.json(quote, { status: 201 })
  } catch (err) {
    console.error('createQuote error:', err)
    return NextResponse.json({ error: '建立報價單失敗' }, { status: 500 })
  }
})
