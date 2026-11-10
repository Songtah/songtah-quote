/**
 * lib/db/visits-write.ts — 客情紀錄的資料庫寫入（2026-11-10 起客情唯一來源；Notion 客情庫已封存）
 * id：新客情由系統產生 uuid（36 字元，與 Notion 頁面 id 同格式），既有列沿用 Notion id。
 */
import { randomUUID } from 'crypto'
import { sql } from './client'
import { bareId } from './read-source'

export type VisitWriteData = {
  contactPerson?: string
  customerName?: string
  date?: string
  salesperson?: string
  status?: string
  content?: string
  address?: string
  customerId?: string
  tags?: string[]
  competitorEquipment?: string[]
  interestedProductIds?: string[]
  interactionType?: string
  interactionPurpose?: string
  customerReaction?: string
  followUpAction?: string
  needsFollowUp?: boolean
  nextFollowUpDate?: string
  followUpDone?: boolean
}

/** 把表單資料對應到欄位（只含有傳入的鍵；undefined 不動） */
function toColumns(d: VisitWriteData): Record<string, any> {
  const c: Record<string, any> = {}
  const nul = (v: any) => (v === '' || v === undefined ? null : v)
  if (d.customerName !== undefined) c.unit_name = d.customerName ?? ''
  if (d.date !== undefined) c.visit_date = nul(d.date)
  if (d.salesperson !== undefined) c.salesperson = nul(d.salesperson)
  if (d.status !== undefined) c.status = nul(d.status)
  if (d.content !== undefined) c.content = nul(d.content)
  if (d.address !== undefined) c.address = nul(d.address)
  if (d.customerId !== undefined) c.customer_notion_id = nul(d.customerId)
  if (d.tags !== undefined) c.customer_tags = d.tags ?? []
  if (d.competitorEquipment !== undefined) c.competitors = d.competitorEquipment ?? []
  if (d.interestedProductIds !== undefined) c.interested_product_ids = d.interestedProductIds ?? []
  if (d.interactionType !== undefined) c.interaction_type = nul(d.interactionType)
  if (d.interactionPurpose !== undefined) c.purpose = nul(d.interactionPurpose)
  if (d.customerReaction !== undefined) c.reaction = nul(d.customerReaction)
  if (d.followUpAction !== undefined) c.next_action = nul(d.followUpAction)
  if (d.needsFollowUp !== undefined) c.needs_follow_up = !!d.needsFollowUp
  if (d.nextFollowUpDate !== undefined) c.next_follow_up = nul(d.nextFollowUpDate)
  if (d.followUpDone !== undefined) c.follow_up_closed = !!d.followUpDone
  if (d.contactPerson !== undefined) c.contact_name = nul(d.contactPerson)
  return c
}

async function resolveCustomerId(db: ReturnType<typeof sql>, customerNotionId: string | null | undefined): Promise<{ id: number | null; notionId: string | null }> {
  if (!customerNotionId) return { id: null, notionId: null }
  const r = await db`select id, notion_page_id from customers where replace(notion_page_id,'-','') = ${bareId(customerNotionId)} limit 1`
  if (!r.length) throw new Error('customerId 不屬於客戶主檔，拒絕寫入')
  return { id: r[0].id, notionId: r[0].notion_page_id }
}

export async function dbCreateVisit(data: VisitWriteData & { customerName: string }): Promise<string> {
  const db = sql()
  const cols = toColumns(data)
  const cust = await resolveCustomerId(db, data.customerId)
  const now = new Date().toISOString()
  const row = {
    notion_page_id: randomUUID(), origin: 'db', ...cols,
    customer_id: cust.id, customer_notion_id: cust.notionId,
    unit_name: data.customerName || '(無名稱)',
    notion_created_at: now, notion_updated_at: now, synced_at: now,
  }
  const keys = Object.keys(row)
  await db`insert into visits ${(db as any)([row], ...keys)}`
  return row.notion_page_id
}

export async function dbUpdateVisit(id: string, data: VisitWriteData): Promise<void> {
  const db = sql()
  const cols = toColumns(data)
  if ('customer_notion_id' in cols) {
    const cust = await resolveCustomerId(db, cols.customer_notion_id)
    cols.customer_id = cust.id
    cols.customer_notion_id = cust.notionId
  }
  cols.notion_updated_at = new Date().toISOString()
  cols.synced_at = cols.notion_updated_at
  const r = await db`update visits set ${db(cols)} where replace(notion_page_id,'-','') = ${bareId(id)}`
  if (r.count === 0) throw new Error('找不到這筆客情')
}

export async function dbDeleteVisit(id: string): Promise<void> {
  await sql()`delete from visits where replace(notion_page_id,'-','') = ${bareId(id)}`
}

/** 單筆原始列（AI 判讀、維修回補等批次用） */
export type VisitRawRow = { id: string; date: string; name: string; sp: string; text: string; reaction: string; contact: string; customerNotionId: string; competitors: string[] }
const raw = (r: any): VisitRawRow => ({
  id: r.notion_page_id, date: r.visit_date ? String(r.visit_date).slice(0, 10) : '', name: r.unit_name ?? '', sp: r.salesperson ?? '',
  text: r.content ?? '', reaction: r.reaction ?? '', contact: r.contact_name ?? '', customerNotionId: r.customer_notion_id ?? '', competitors: r.competitors ?? [],
})
const d10 = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

export async function dbVisitRaw(id: string): Promise<VisitRawRow | null> {
  const r = await sql()`select notion_page_id, visit_date, unit_name, salesperson, content, reaction, contact_name, customer_notion_id, competitors from visits where replace(notion_page_id,'-','') = ${bareId(id)} limit 1`
  return r.length ? { ...raw(r[0]), date: d10(r[0].visit_date) } : null
}

export async function dbAllVisitRaw(opts?: { linkedOnly?: boolean; sinceDate?: string; withTextOnly?: boolean }): Promise<VisitRawRow[]> {
  const rows = await sql()`select notion_page_id, visit_date, unit_name, salesperson, content, reaction, contact_name, customer_notion_id, competitors from visits
    where (${!opts?.linkedOnly} or customer_notion_id is not null)
      and (${opts?.sinceDate ?? null}::date is null or visit_date >= ${opts?.sinceDate ?? null})
      and (${!opts?.withTextOnly} or (content is not null and content <> ''))
    order by visit_date desc nulls last`
  return rows.map((r: any) => ({ ...raw(r), date: d10(r.visit_date) }))
}

/** 競品欄為空的客情（分頁，新到舊） */
export async function dbVisitsWithoutCompetitors(limit: number, offset: number): Promise<{ rows: VisitRawRow[]; hasMore: boolean }> {
  const rows = await sql()`select notion_page_id, visit_date, unit_name, salesperson, content, reaction, contact_name, customer_notion_id, competitors from visits
    where cardinality(competitors) = 0 order by visit_date desc nulls last, notion_created_at desc limit ${limit + 1} offset ${offset}`
  return { rows: rows.slice(0, limit).map((r: any) => ({ ...raw(r), date: d10(r.visit_date) })), hasMore: rows.length > limit }
}

/** 未連客戶的客情（分頁，新到舊） */
export async function dbVisitsUnlinked(limit: number, offset: number): Promise<{ rows: VisitRawRow[]; hasMore: boolean }> {
  const rows = await sql()`select notion_page_id, visit_date, unit_name, salesperson, content, reaction, contact_name, customer_notion_id, competitors from visits
    where customer_notion_id is null order by visit_date desc nulls last, notion_created_at desc limit ${limit + 1} offset ${offset}`
  return { rows: rows.slice(0, limit).map((r: any) => ({ ...raw(r), date: d10(r.visit_date) })), hasMore: rows.length > limit }
}

/** 去重用：全部客情的輕量列 */
export async function dbVisitsForDedup(): Promise<{ id: string; customerName: string; date: string; salesperson: string; contentLen: number }[]> {
  const rows = await sql()`select notion_page_id, unit_name, visit_date, salesperson, coalesce(length(content),0)::int len from visits`
  return rows.map((r: any) => ({ id: r.notion_page_id, customerName: r.unit_name ?? '', date: d10(r.visit_date), salesperson: r.salesperson ?? '', contentLen: r.len }))
}

/** 退回用：系統產生（origin='db'）的客情數 */
export async function dbCountDbOriginVisits(): Promise<number> {
  const [r] = await sql()`select count(*)::int n from visits where origin = 'db'`
  return r.n
}
