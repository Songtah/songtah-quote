/**
 * lib/db/event-forms.ts — 活動問卷／滿意度調查的資料庫存取（Supabase）。只在伺服器端使用。
 * 形狀與驗證在 lib/event-forms-model.ts。
 */
import { sql } from './client'
import type { EventForm, FormKind, FormResponse } from '@/lib/event-forms-model'

const bare = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
const iso = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v))
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const toForm = (r: any): EventForm => ({
  id: r.id, eventId: r.event_id, kind: r.kind, title: r.title, intro: r.intro, gift: r.gift,
  identity: r.identity, questions: r.questions ?? [], open: !!r.open, updatedAt: iso(r.updated_at),
})
const toResponse = (r: any): FormResponse => ({
  id: r.id, name: r.name ?? '', phone: r.phone ?? '', institution: r.institution ?? '', city: r.city ?? '', district: r.district ?? '', jobTitle: r.job_title ?? '', answers: r.answers ?? {},
  giftClaimedAt: iso(r.gift_claimed_at), giftClaimedBy: r.gift_claimed_by ?? '', createdAt: iso(r.created_at),
})

export async function getEventForm(eventId: string, kind: FormKind): Promise<EventForm | null> {
  const r = await sql()`select * from event_forms where event_id = ${bare(eventId)} and kind = ${kind}`
  return r.length ? toForm(r[0]) : null
}

export async function getFormById(formId: string): Promise<EventForm | null> {
  if (!isUuid(formId)) return null
  const r = await sql()`select * from event_forms where id = ${formId}`
  return r.length ? toForm(r[0]) : null
}

export async function saveEventForm(eventId: string, data: Omit<EventForm, 'id' | 'eventId' | 'updatedAt'>): Promise<EventForm> {
  const db = sql()
  const r = await db`
    insert into event_forms (event_id, kind, title, intro, gift, identity, questions, open)
    values (${bare(eventId)}, ${data.kind}, ${data.title}, ${data.intro}, ${data.gift}, ${data.identity}, ${db.json(data.questions as any)}, ${data.open})
    on conflict (event_id, kind) do update set title = excluded.title, intro = excluded.intro, gift = excluded.gift,
      identity = excluded.identity, questions = excluded.questions, open = excluded.open, updated_at = now()
    returning *`
  return toForm(r[0])
}

export async function listResponses(formId: string): Promise<FormResponse[]> {
  const r = await sql()`select * from event_form_responses where form_id = ${formId} order by created_at desc`
  return r.map(toResponse)
}

export async function getResponse(formId: string, responseId: string): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = await sql()`select * from event_form_responses where id = ${responseId} and form_id = ${formId}`
  return r.length ? toResponse(r[0]) : null
}

/** 新增一筆回覆。同一份問卷同一支手機（末 8 碼）已填過就回傳原本那筆，不重複建立。 */
export async function addResponse(form: EventForm, data: { name: string; phone: string; institution: string; city?: string; district?: string; jobTitle?: string; answers: Record<string, unknown> }): Promise<{ response: FormResponse; duplicate: boolean }> {
  const db = sql()
  const digits = data.phone.replace(/\D/g, '')
  const tail = digits.length >= 8 ? digits.slice(-8) : null
  if (tail) {
    const dup = await db`select * from event_form_responses where form_id = ${form.id} and phone_tail = ${tail}`
    if (dup.length) return { response: toResponse(dup[0]), duplicate: true }
  }
  const r = await db`
    insert into event_form_responses (form_id, event_id, name, phone, phone_tail, institution, city, district, job_title, answers)
    values (${form.id}, ${form.eventId}, ${data.name || null}, ${data.phone || null}, ${tail}, ${data.institution || null}, ${data.city || null}, ${data.district || null}, ${data.jobTitle || null}, ${db.json(data.answers as any)})
    on conflict (form_id, phone_tail) where phone_tail is not null do nothing
    returning *`
  if (!r.length && tail) {
    const dup = await db`select * from event_form_responses where form_id = ${form.id} and phone_tail = ${tail}`
    return { response: toResponse(dup[0]), duplicate: true }
  }
  return { response: toResponse(r[0]), duplicate: false }
}

/** 標記／取消贈品已領。回傳更新後的回覆；找不到回 null。 */
export async function setGiftClaimed(formId: string, responseId: string, claimed: boolean, by: string): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = claimed
    ? await sql()`update event_form_responses set gift_claimed_at = coalesce(gift_claimed_at, now()), gift_claimed_by = coalesce(gift_claimed_by, ${by}) where id = ${responseId} and form_id = ${formId} returning *`
    : await sql()`update event_form_responses set gift_claimed_at = null, gift_claimed_by = null where id = ${responseId} and form_id = ${formId} returning *`
  return r.length ? toResponse(r[0]) : null
}
