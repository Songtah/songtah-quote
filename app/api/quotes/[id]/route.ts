import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getQuote, deleteQuote } from '@/lib/notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    const quote = await getQuote(params.id)
    if (!quote) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })
    return NextResponse.json(quote)
  } catch (err) {
    console.error('getQuote error:', err)
    return NextResponse.json({ error: '無法取得報價單' }, { status: 500 })
  }
})

export const DELETE = withApiAuth({ module: 'quote', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const before = await getQuote(params.id).catch(() => null)
    await deleteQuote(params.id)

    await logAuditEvent({
      module: 'quote',
      action: 'delete',
      entityType: 'quote',
      entityId: params.id,
      entityTitle: before?.quoteNumber ?? '',
      summary: `刪除報價單：${before?.quoteNumber ?? params.id}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
    }).catch((error) => console.error('audit deleteQuote error:', error))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('deleteQuote error:', err)
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 })
  }
})
