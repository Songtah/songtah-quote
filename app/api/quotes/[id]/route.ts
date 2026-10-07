import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getQuote, deleteQuote, updateQuote } from '@/lib/notion'
import { parseQuoteInput } from '@/lib/quote-input'
import { QUOTE_TRANSITIONS, canEditQuote } from '@/lib/quote-status'
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

/**
 * PUT — 修改報價單內容（含明細）。只有草稿／待行政審核／已退回可改；已核准後價格定格。
 * body.submit=true：草稿或已退回者修改後一併送出審核（依 lib/quote-status 的 submit 規則）。
 */
export const PUT = withApiAuth({ module: 'quote', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const before = await getQuote(params.id)
    if (!before) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })
    if (!canEditQuote(before.status)) {
      return NextResponse.json({ error: `報價單目前為「${before.status}」，不能修改；如需調整請先由管理員退回` }, { status: 409 })
    }
    const body = await req.json()
    const { input, error } = parseQuoteInput(body)
    if (!input) return NextResponse.json({ error }, { status: 400 })

    let nextStatus: string | undefined
    if (body?.submit === true) {
      const t = QUOTE_TRANSITIONS[before.status]?.submit
      if (t) nextStatus = t.to   // 待行政審核本身就在審核中，存檔即可，不需轉換
    }

    const after = await updateQuote(params.id, input, nextStatus)

    await logAuditEvent({
      module: 'quote',
      action: 'update',
      entityType: 'quote',
      entityId: after.id,
      entityTitle: after.quoteNumber,
      summary: `修改報價單：${after.quoteNumber}${nextStatus ? `（${before.status} → ${nextStatus}）` : ''}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
      after,
      metadata: { itemCount: input.items.length },
    }).catch((e) => console.error('audit updateQuote error:', e))

    return NextResponse.json(after)
  } catch (err) {
    console.error('updateQuote error:', err)
    return NextResponse.json({ error: '修改報價單失敗' }, { status: 500 })
  }
})
