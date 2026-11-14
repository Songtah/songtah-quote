/**
 * /api/events/[id]/forms —— 活動問卷／滿意度調查（後台）
 *   GET  ?kind=survey|satisfaction  表單設定＋回覆＋各題彙總
 *   PUT  { kind, title, intro, gift, identity, questions, open }  儲存設定
 *   PATCH { kind, responseId, claimed }  標記／取消「贈品已領」
 *   PATCH { kind, responseId, customerId }  人工改配／取消配對客戶（customerId=null）
 *   PATCH { kind, responseId, edit: {...} }  修改回覆的基本資料與作答（僅中央管理，寫稽核）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getEventById } from '@/lib/notion/events'
import { getEventForm, saveEventForm, listResponses, setGiftClaimed, setResponseCustomer, setNoticeSent, updateResponse } from '@/lib/db/event-forms'
import { signConsentToken } from '@/lib/consent-token'
import { matchExistingCustomer } from '@/lib/registration-footprint'
import { getSystemCustomerById, getAllSystemCustomers, getCustomersWithCodes } from '@/lib/notion/customers'
import { resolveCustomerInfo } from '@/lib/notion/relations'
import type { FormResponse } from '@/lib/event-forms-model'
import { sanitizeFormInput, summarize, validateAnswers, JOB_TITLES, FORM_KIND_LABEL, type FormKind } from '@/lib/event-forms-model'
import { isValidDistrict } from '@/lib/tw-districts'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
type Ctx = { params: { id: string } }
const kindOf = (v: unknown): FormKind | null => (v === 'survey' || v === 'satisfaction' ? v : null)

export const GET = withApiAuth({ module: 'events', action: 'view' }, async (req: NextRequest, { params }: Ctx) => {
  const kind = kindOf(req.nextUrl.searchParams.get('kind'))
  if (!kind) return NextResponse.json({ error: '缺少表單類型' }, { status: 400 })
  const form = await getEventForm(params.id, kind)
  if (!form) return NextResponse.json({ form: null, responses: [], summary: [] })
  let responses = await listResponses(form.id)
  responses = await autoMatch(form.id, responses)
  const info = await resolveCustomerInfo(responses.map((r) => r.customerId).filter(Boolean)).catch(() => ({} as Record<string, { name: string; city: string; district: string }>))
  // 告知頁上線前填寫、尚未同意者：附上個人補告知連結（簽章），供行政複製補告知信
  const origin = req.nextUrl.origin
  responses = responses.map((r) => {
    const token = !r.consentAt && (r.name || r.phone || r.email) ? signConsentToken(r.id) : null
    return {
      ...r, customerName: info[r.customerId]?.name ?? '', customerArea: info[r.customerId] ? `${info[r.customerId].city}${info[r.customerId].district}` : '',
      ...(token ? { consentLink: `${origin}/consent/${r.id}?t=${token}` } : {}),
    }
  })
  const event = await getEventById(params.id).catch(() => null)
  return NextResponse.json({ form, responses, summary: summarize(form, responses), eventName: event?.name ?? '' })
})

/** 還沒配對過（沒有配對說明）且有填單位的回覆，開名單時自動配一次；結果（含配不到的原因）存起來，不會每次重算 */
async function autoMatch(formId: string, responses: FormResponse[]): Promise<FormResponse[]> {
  const todo = responses.filter((r) => !r.customerId && !r.matchNote && r.institution.trim()).slice(0, 200)
  if (!todo.length) return responses
  const cache = { customers: await getAllSystemCustomers(), codes: new Map((await getCustomersWithCodes()).filter((c) => c.institutionCode).map((c) => [c.institutionCode, c])) }
  const updated = new Map<string, FormResponse>()
  for (const r of todo) {
    try {
      const m = await matchExistingCustomer({ institution: r.institution, city: r.city, district: r.district, phone: r.phone }, cache)
      const saved = await setResponseCustomer(formId, r.id, m.customerId, m.note || (m.customerId ? '自動配對' : '無法確定客戶'), true)
      if (saved) updated.set(saved.id, saved)
    } catch (e) { console.warn('[forms] 自動配對失敗：', r.id, (e as Error).message) }
  }
  return responses.map((r) => updated.get(r.id) ?? r)
}

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
  if (body.edit && typeof body.edit === 'object') {
    const u = session.user as any
    if (u?.role !== 'admin' && u?.accountType !== '中央管理') return NextResponse.json({ error: '只有中央管理可以修改問卷回覆' }, { status: 403 })
    const e = body.edit
    const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
    const email = clip(e.email, 120)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: '信箱格式不正確' }, { status: 400 })
    const city = clip(e.city, 10), district = clip(e.district, 10)
    if ((city || district) && !isValidDistrict(city, district)) return NextResponse.json({ error: '縣市與鄉鎮市區不相符' }, { status: 400 })
    const jobTitle = (JOB_TITLES as readonly string[]).includes(e.jobTitle) ? e.jobTitle : ''
    let answers: Record<string, unknown>
    try { answers = validateAnswers({ questions: form.questions.map((q) => ({ ...q, required: false })) }, e.answers) }   // 後台修正不強制必答
    catch (err: any) { return NextResponse.json({ error: err?.message ?? '作答格式錯誤' }, { status: 400 }) }
    try {
      const r = await updateResponse(form.id, body.responseId, { name: clip(e.name, 50), phone: clip(e.phone, 30), institution: clip(e.institution, 100), city, district, jobTitle, email, answers })
      if (!r) return NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
      logAuditEvent({
        module: 'events', action: 'update', entityType: 'event-form-response', entityId: r.id,
        summary: `修改${FORM_KIND_LABEL[kind]}回覆：${r.name || r.institution || r.id}`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
      }).catch(() => {})
      return NextResponse.json({ response: r })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? '儲存失敗' }, { status: 400 })
    }
  }
  if ('noticeSent' in body) {
    const r = await setNoticeSent(form.id, body.responseId, body.noticeSent === true)
    if (!r) return NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
    logAuditEvent({
      module: 'events', action: 'update', entityType: 'event-form-renotice', entityId: r.id,
      summary: `${body.noticeSent === true ? '標記已寄個資補告知' : '取消個資補告知標記'}：${r.name || r.email || r.id}`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
    }).catch(() => {})
    return NextResponse.json({ noticeSentAt: r.noticeSentAt })
  }
  if ('customerId' in body) {
    const cid = typeof body.customerId === 'string' && body.customerId ? body.customerId : null
    const cust = cid ? await getSystemCustomerById(cid) : null
    if (cid && !cust) return NextResponse.json({ error: '找不到這個客戶' }, { status: 404 })
    const note = cust ? `人工配對：${by}` : `人工取消配對：${by}`
    const r = await setResponseCustomer(form.id, body.responseId, cust ? cust.id : null, note)
    if (!r) return NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
    logAuditEvent({
      module: 'events', action: 'update', entityType: 'event-form-customer', entityId: r.id,
      summary: `${cust ? `問卷回覆配對客戶：${r.institution || r.name} → ${cust.name}` : `取消問卷回覆的客戶配對：${r.institution || r.name}`}`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
    }).catch(() => {})
    return NextResponse.json({ customerId: r.customerId, customerName: cust?.name ?? '', customerArea: cust ? `${cust.city}${cust.district}` : '', matchNote: r.matchNote })
  }
  const response = await setGiftClaimed(form.id, body.responseId, body.claimed !== false, by)
  if (!response) return NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
  logAuditEvent({
    module: 'events', action: 'update', entityType: 'event-form-gift', entityId: response.id,
    summary: `${body.claimed !== false ? '標記贈品已領' : '取消贈品已領'}：${response.name || response.phone || response.id}`,
    actor: getAuditActor(session), request: getAuditRequestContext(req),
  }).catch(() => {})
  return NextResponse.json({ response })
})
