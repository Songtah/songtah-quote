import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomerEvents, listAllEvents } from '@/lib/notion/events'
import { listCustomerResponses } from '@/lib/db/event-forms'
import { FORM_KIND_LABEL } from '@/lib/event-forms-model'

export type CustomerEventSurvey = {
  id: string; kind: string; kindLabel: string; title: string; name: string; jobTitle: string
  createdAt: string; giftClaimed: boolean; answers: { q: string; a: string }[]
}
export type CustomerEventItem = {
  key: string; eventId: string; eventName: string; eventDate: string; eventType: string
  /** 報名紀錄（沒報名、只填問卷者為 null） */
  registration: { id: string; status: string; source: string; contact: string; registeredAt: string; institution: string } | null
  surveys: CustomerEventSurvey[]
}

const fmtAnswer = (v: unknown) => (v == null || v === '' ? '' : Array.isArray(v) ? v.join('、') : String(v))

/**
 * 客戶頁「參加活動」：同一場活動的報名紀錄與該客戶填過的問卷合併成一筆。
 * 問卷依回覆名單的「客戶配對」歸屬（自動配對或人工改配），沒報名只填問卷也會列出。
 */
export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const [regs, responses] = await Promise.all([
    listCustomerEvents(params.id),
    listCustomerResponses(params.id).catch(() => []),
  ])
  if (!regs.length && !responses.length) return NextResponse.json([])
  const events = new Map((await listAllEvents().catch(() => [])).map((e) => [e.id.replace(/-/g, ''), e]))
  const evOf = (id: string) => events.get((id ?? '').replace(/-/g, ''))

  const items = new Map<string, CustomerEventItem>()
  const itemFor = (eventId: string, fallbackName: string, key: string) => {
    const k = eventId ? eventId.replace(/-/g, '') : key
    let it = items.get(k)
    if (!it) {
      const ev = eventId ? evOf(eventId) : undefined
      it = { key: k, eventId: ev?.id ?? eventId, eventName: ev?.name || fallbackName, eventDate: ev?.date ?? '', eventType: ev?.type ?? '', registration: null, surveys: [] }
      items.set(k, it)
    }
    return it
  }
  for (const r of regs) {
    const it = itemFor(r.eventId, r.formEventName || r.institution, `reg:${r.id}`)
    if (!it.registration) it.registration = { id: r.id, status: r.status, source: r.source, contact: r.contact, registeredAt: r.registeredAt, institution: r.institution }
  }
  for (const { eventId, form, response } of responses) {
    const it = itemFor(eventId, '', `form:${form.id}`)
    it.surveys.push({
      id: response.id, kind: form.kind, kindLabel: FORM_KIND_LABEL[form.kind], title: form.title, name: response.name, jobTitle: response.jobTitle,
      createdAt: response.createdAt, giftClaimed: !!response.giftClaimedAt,
      answers: form.questions.map((q) => ({ q: q.label, a: fmtAnswer(response.answers?.[q.id]) })).filter((x) => x.a),
    })
  }
  const dateOf = (it: CustomerEventItem) => it.eventDate || it.registration?.registeredAt?.slice(0, 10) || it.surveys[0]?.createdAt?.slice(0, 10) || ''
  return NextResponse.json(Array.from(items.values()).sort((a, b) => dateOf(b).localeCompare(dateOf(a))))
})
