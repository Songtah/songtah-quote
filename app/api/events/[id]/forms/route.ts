/**
 * /api/events/[id]/forms —— 活動問卷／滿意度調查（後台）
 *   GET  ?kind=survey|satisfaction  表單設定＋回覆＋各題彙總
 *   PUT  { kind, title, intro, gift, identity, questions, open }  儲存設定
 *   PATCH { kind, responseId, claimed }  標記／取消「贈品已領」
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getEventById } from '@/lib/notion/events'
import { getEventForm, saveEventForm, listResponses, setGiftClaimed } from '@/lib/db/event-forms'
import { sanitizeFormInput, summarize, FORM_KIND_LABEL, type FormKind } from '@/lib/event-forms-model'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
type Ctx = { params: { id: string } }
const kindOf = (v: unknown): FormKind | null => (v === 'survey' || v === 'satisfaction' ? v : null)

export const GET = withApiAuth({ module: 'events', action: 'view' }, async (req: NextRequest, { params }: Ctx) => {
  const kind = kindOf(req.nextUrl.searchParams.get('kind'))
  if (!kind) return NextResponse.json({ error: '缺少表單類型' }, { status: 400 })
  const form = await getEventForm(params.id, kind)
  if (!form) return NextResponse.json({ form: null, responses: [], summary: [] })
  const responses = await listResponses(form.id)
  return NextResponse.json({ form, responses, summary: summarize(form, responses) })
})

export const PUT = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, { params }: Ctx, session) => {
  const body = await req.json().catch(() => null)
  const kind = kindOf(body?.kind)
  if (!kind) return NextResponse.json({ error: '缺少表單類型' }, { status: 400 })
  const event = await getEventById(params.id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  try {
    const before = await getEventForm(params.id, kind)
    const form = await saveEventForm(params.id, sanitizeFormInput(kind, body))
    logAuditEvent({
      module: 'events', action: before ? 'update' : 'create', entityType: 'event-form', entityId: form.id, entityTitle: event.name,
      summary: `${before ? '更新' : '建立'}${FORM_KIND_LABEL[kind]}：${event.name}（${form.questions.length} 題，${form.open ? '開放填寫' : '未開放'}）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
    }).catch(() => {})
    return NextResponse.json({ form })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '儲存失敗' }, { status: 400 })
  }
})

export const PATCH = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, { params }: Ctx, session) => {
  const body = await req.json().catch(() => null)
  const kind = kindOf(body?.kind)
  if (!kind || typeof body?.responseId !== 'string') return NextResponse.json({ error: '資料不完整' }, { status: 400 })
  const form = await getEventForm(params.id, kind)
  if (!form) return NextResponse.json({ error: '找不到表單' }, { status: 404 })
  const by = (session.user as any)?.name ?? '未知'
  const response = await setGiftClaimed(form.id, body.responseId, body.claimed !== false, by)
  if (!response) return NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
  logAuditEvent({
    module: 'events', action: 'update', entityType: 'event-form-gift', entityId: response.id,
    summary: `${body.claimed !== false ? '標記贈品已領' : '取消贈品已領'}：${response.name || response.phone || response.id}`,
    actor: getAuditActor(session), request: getAuditRequestContext(req),
  }).catch(() => {})
  return NextResponse.json({ response })
})
