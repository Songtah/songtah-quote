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
  id: r.id, eventId: r.event_id, kind: r.kind, title: r.title, intro: r.intro, gift: r.gift, giftImage: r.gift_image ?? '',
  identity: r.identity, questions: r.questions ?? [], open: !!r.open, updatedAt: iso(r.updated_at),
})
const toResponse = (r: any): FormResponse => ({
  id: r.id, name: r.name ?? '', phone: r.phone ?? '', institution: r.institution ?? '', city: r.city ?? '', district: r.district ?? '', jobTitle: r.job_title ?? '', email: r.email ?? '', consentAt: iso(r.consent_at), consentVersion: r.consent_version ?? '', marketingOptIn: !!r.marketing_opt_in, consentSource: r.consent_source ?? '', noticeSentAt: iso(r.notice_sent_at), answers: r.answers ?? {},
  giftClaimedAt: iso(r.gift_claimed_at), giftClaimedBy: r.gift_claimed_by ?? '', createdAt: iso(r.created_at),
  customerId: r.customer_id ?? '', matchNote: r.match_note ?? '',
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
    insert into event_forms (event_id, kind, title, intro, gift, gift_image, identity, questions, open)
    values (${bare(eventId)}, ${data.kind}, ${data.title}, ${data.intro}, ${data.gift}, ${data.giftImage}, ${data.identity}, ${db.json(data.questions as any)}, ${data.open})
    on conflict (event_id, kind) do update set title = excluded.title, intro = excluded.intro, gift = excluded.gift, gift_image = excluded.gift_image,
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
export async function addResponse(form: EventForm, data: { name: string; phone: string; institution: string; city?: string; district?: string; jobTitle?: string; email?: string; consentVersion?: string; marketingOptIn?: boolean; answers: Record<string, unknown> }): Promise<{ response: FormResponse; duplicate: boolean }> {
  const db = sql()
  const digits = data.phone.replace(/\D/g, '')
  const tail = digits.length >= 8 ? digits.slice(-8) : null
  if (tail) {
    const dup = await db`select * from event_form_responses where form_id = ${form.id} and phone_tail = ${tail}`
    if (dup.length) return { response: toResponse(dup[0]), duplicate: true }
  }
  const r = await db`
    insert into event_form_responses (form_id, event_id, name, phone, phone_tail, institution, city, district, job_title, email, consent_at, consent_version, marketing_opt_in, consent_source, answers)
    values (${form.id}, ${form.eventId}, ${data.name || null}, ${data.phone || null}, ${tail}, ${data.institution || null}, ${data.city || null}, ${data.district || null}, ${data.jobTitle || null}, ${data.email || null}, ${data.consentVersion ? new Date() : null}, ${data.consentVersion || null}, ${data.consentVersion ? !!data.marketingOptIn : null}, ${data.consentVersion ? 'form' : null}, ${db.json(data.answers as any)})
    on conflict (form_id, phone_tail) where phone_tail is not null do nothing
    returning *`
  if (!r.length && tail) {
    const dup = await db`select * from event_form_responses where form_id = ${form.id} and phone_tail = ${tail}`
    return { response: toResponse(dup[0]), duplicate: true }
  }
  return { response: toResponse(r[0]), duplicate: false }
}

/** 寫入客戶配對。onlyIfAuto＝true 時（自動配對）不覆蓋人工調整過的那筆。 */
export async function setResponseCustomer(formId: string, responseId: string, customerId: string | null, note: string, onlyIfAuto = false): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = onlyIfAuto
    ? await sql()`update event_form_responses set customer_id = ${customerId}, match_note = ${note} where id = ${responseId} and form_id = ${formId} and coalesce(match_note, '') not like '人工%' returning *`
    : await sql()`update event_form_responses set customer_id = ${customerId}, match_note = ${note} where id = ${responseId} and form_id = ${formId} returning *`
  return r.length ? toResponse(r[0]) : null
}

/** 某客戶填過的所有問卷（依配對到的客戶），附表單類型、標題與題目，供客戶頁「參加活動」顯示 */
export async function listCustomerResponses(customerId: string): Promise<{ eventId: string; form: EventForm; response: FormResponse }[]> {
  const rows = await sql()`
    select r.*, f.id as f_id, f.event_id as f_event_id, f.kind as f_kind, f.title as f_title, f.intro as f_intro, f.gift as f_gift, f.gift_image as f_gift_image,
           f.identity as f_identity, f.questions as f_questions, f.open as f_open, f.updated_at as f_updated_at
    from event_form_responses r join event_forms f on f.id = r.form_id
    where replace(lower(coalesce(r.customer_id, '')), '-', '') = ${bare(customerId)}
    order by r.created_at desc`
  return rows.map((r: any) => ({
    eventId: r.f_event_id,
    form: toForm({ id: r.f_id, event_id: r.f_event_id, kind: r.f_kind, title: r.f_title, intro: r.f_intro, gift: r.f_gift, gift_image: r.f_gift_image, identity: r.f_identity, questions: r.f_questions, open: r.f_open, updated_at: r.f_updated_at }),
    response: toResponse(r),
  }))
}

/**
 * 中央管理修改問卷回覆的基本資料與作答。手機改了要同步末 8 碼（同一份問卷同一支手機只收一筆）；
 * 單位或地區改了且客戶配對不是人工調整的，清掉配對讓下次開名單重新自動配對。
 */
export async function updateResponse(formId: string, responseId: string, data: {
  name: string; phone: string; institution: string; city: string; district: string; jobTitle: string; email: string; answers: Record<string, unknown>
}): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const db = sql()
  const cur = await db`select * from event_form_responses where id = ${responseId} and form_id = ${formId}`
  if (!cur.length) return null
  const digits = data.phone.replace(/\D/g, '')
  const tail = digits.length >= 8 ? digits.slice(-8) : null
  if (tail) {
    const dup = await db`select id from event_form_responses where form_id = ${formId} and phone_tail = ${tail} and id <> ${responseId}`
    if (dup.length) throw new Error('這支手機在同一份問卷已經有另一筆回覆')
  }
  const old = cur[0]
  const rematch = (old.institution ?? '') !== data.institution || (old.city ?? '') !== data.city || (old.district ?? '') !== data.district
  const manual = String(old.match_note ?? '').startsWith('人工')
  const r = await db`update event_form_responses set
      name = ${data.name || null}, phone = ${data.phone || null}, phone_tail = ${tail}, institution = ${data.institution || null},
      city = ${data.city || null}, district = ${data.district || null}, job_title = ${data.jobTitle || null}, email = ${data.email || null},
      answers = ${db.json(data.answers as any)}
    where id = ${responseId} and form_id = ${formId} returning *`
  if (!r.length) return null
  if (rematch && !manual) {   // 不用巢狀片段：lib/db/client 的排隊包裝只認得完整查詢
    const r2 = await db`update event_form_responses set customer_id = null, match_note = null where id = ${responseId} returning *`
    return toResponse(r2[0])
  }
  return toResponse(r[0])
}

/** 補告知：標記／取消「已寄出補告知信」 */
export async function setNoticeSent(formId: string, responseId: string, sent: boolean): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = sent
    ? await sql()`update event_form_responses set notice_sent_at = coalesce(notice_sent_at, now()) where id = ${responseId} and form_id = ${formId} returning *`
    : await sql()`update event_form_responses set notice_sent_at = null where id = ${responseId} and form_id = ${formId} returning *`
  return r.length ? toResponse(r[0]) : null
}

/** 補告知連結：只看回覆 id（連結已簽章），回傳回覆與所屬表單 */
export async function getResponseForConsent(responseId: string): Promise<{ response: FormResponse; formId: string; eventId: string; formTitle: string } | null> {
  if (!isUuid(responseId)) return null
  const r = await sql()`select r.*, f.title as f_title from event_form_responses r join event_forms f on f.id = r.form_id where r.id = ${responseId}`
  return r.length ? { response: toResponse(r[0]), formId: r[0].form_id, eventId: r[0].event_id, formTitle: r[0].f_title ?? '' } : null
}

/** 補告知連結勾選同意：已同意過就不覆蓋（保留原本的同意時間與來源） */
export async function recordRenoticeConsent(responseId: string, version: string, marketing: boolean): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = await sql()`update event_form_responses
    set consent_at = now(), consent_version = ${version}, marketing_opt_in = ${marketing}, consent_source = 'renotice'
    where id = ${responseId} and consent_at is null returning *`
  if (r.length) return toResponse(r[0])
  const cur = await sql()`select * from event_form_responses where id = ${responseId}`
  return cur.length ? toResponse(cur[0]) : null
}

/** 標記／取消贈品已領。回傳更新後的回覆；找不到回 null。 */
export async function setGiftClaimed(formId: string, responseId: string, claimed: boolean, by: string): Promise<FormResponse | null> {
  if (!isUuid(responseId)) return null
  const r = claimed
    ? await sql()`update event_form_responses set gift_claimed_at = coalesce(gift_claimed_at, now()), gift_claimed_by = coalesce(gift_claimed_by, ${by}) where id = ${responseId} and form_id = ${formId} returning *`
    : await sql()`update event_form_responses set gift_claimed_at = null, gift_claimed_by = null where id = ${responseId} and form_id = ${formId} returning *`
  return r.length ? toResponse(r[0]) : null
}
