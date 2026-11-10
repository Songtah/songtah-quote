/**
 * lib/db/visits-read.ts — 客情紀錄的資料庫讀取（Supabase），形狀與 lib/notion/visits.ts 一致。
 * 客戶名稱／縣市／行政區由 customers 表 join 取得（有關聯以客戶主檔為準，無關聯用手打名稱）。
 */
import { sql } from './client'
import { bareId } from './read-source'
import { resolveProductNames } from '@/lib/notion/relations'
import type { Visit, VisitListResult, CustomerVisitSignal, VisitClaimSignal } from '@/lib/notion/visits'

const s = (v: any) => (v ?? '') as string
const d = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

const SELECT = `
  select v.*, c.name as c_name, c.county as c_county, c.district as c_district
  from visits v left join customers c on c.id = v.customer_id`

async function toVisits(rows: any[]): Promise<Visit[]> {
  const pids = Array.from(new Set(rows.flatMap((r) => (r.interested_product_ids ?? []) as string[])))
  const names = pids.length ? await resolveProductNames(pids) : {}
  return rows.map((r) => ({
    id: r.notion_page_id,
    customerId: s(r.customer_notion_id),
    customerName: s(r.c_name) || s(r.unit_name),
    date: d(r.visit_date),
    salesperson: s(r.salesperson),
    status: s(r.visit_nature) || s(r.status),
    content: s(r.content),
    address: s(r.address),
    city: s(r.c_county),
    district: s(r.c_district),
    tags: (r.customer_tags ?? []) as string[],
    competitorEquipment: (r.competitors ?? []) as string[],
    interestedProducts: ((r.interested_product_ids ?? []) as string[]).map((id) => ({ id, name: names[id] ?? '' })).filter((p) => p.name),
    interactionType: s(r.interaction_type),
    interactionPurpose: s(r.purpose),
    customerReaction: s(r.reaction),
    followUpAction: s(r.next_action),
    needsFollowUp: !!r.needs_follow_up,
    nextFollowUpDate: d(r.next_follow_up),
    followUpDone: !!r.follow_up_closed,
  }))
}

export async function dbListVisits(options?: {
  customerName?: string; customerId?: string; salesperson?: string
  dateFrom?: string; dateTo?: string; cursor?: string; limit?: number; fetchAll?: boolean
}): Promise<VisitListResult> {
  const db = sql()
  const cid = options?.customerId ? bareId(options.customerId) : null
  const cname = !cid && options?.customerName ? `%${options.customerName}%` : null
  const limit = options?.fetchAll ? null : (options?.limit ?? 10)
  const offset = options?.cursor?.startsWith('o:') ? Number(options.cursor.slice(2)) || 0 : 0
  const rows = await db.unsafe(`${SELECT}
    where ($1::text is null or replace(v.customer_notion_id,'-','') = $1)
      and ($2::text is null or v.unit_name ilike $2 or c.name ilike $2)
      and ($3::text is null or v.salesperson = $3)
      and ($4::date is null or v.visit_date >= $4)
      and ($5::date is null or v.visit_date <= $5)
    order by v.visit_date desc nulls last, v.notion_created_at desc
    ${limit == null ? '' : `limit ${limit + 1} offset ${offset}`}`,
    [cid, cname, options?.salesperson ?? null, options?.dateFrom ?? null, options?.dateTo ?? null])
  if (limit == null) return { items: await toVisits(rows as any[]), hasMore: false, nextCursor: null }
  const hasMore = rows.length > limit
  return { items: await toVisits((rows as any[]).slice(0, limit)), hasMore, nextCursor: hasMore ? `o:${offset + limit}` : null }
}

export async function dbGetVisitById(id: string): Promise<Visit | null> {
  const rows = await sql().unsafe(`${SELECT} where replace(v.notion_page_id,'-','') = $1 limit 1`, [bareId(id)])
  if (!rows.length) return null
  return (await toVisits(rows as any[]))[0]
}

const COMPLETE = ['結案', '沒興趣']

export async function dbListOpenFollowUps(salesperson?: string): Promise<Visit[]> {
  const rows = await sql().unsafe(`${SELECT}
    where v.follow_up_closed = false and (v.needs_follow_up = true or v.status = '追蹤中')
      and coalesce(v.status,'') not in ('結案','沒興趣')
      and ($1::text is null or v.salesperson = $1)
    order by v.visit_date desc nulls last`, [salesperson ?? null])
  const items = await toVisits(rows as any[])
  const byCustomer = new Map<string, Visit>()
  for (const it of items) {
    const key = `${it.salesperson}|${it.customerId || it.customerName}`
    const kept = byCustomer.get(key)
    if (!kept || (it.date ?? '') > (kept.date ?? '')) byCustomer.set(key, it)
  }
  return Array.from(byCustomer.values()).sort((a, b) => {
    if (a.nextFollowUpDate && !b.nextFollowUpDate) return -1
    if (!a.nextFollowUpDate && b.nextFollowUpDate) return 1
    if (a.nextFollowUpDate && b.nextFollowUpDate) return a.nextFollowUpDate.localeCompare(b.nextFollowUpDate)
    return (b.date ?? '').localeCompare(a.date ?? '')
  })
}

/** autoCloseStaleFollowUps 用的輕量列 */
export async function dbFollowUpRows(): Promise<{ id: string; name: string; sp: string; date: string; need: boolean; done: boolean; status: string }[]> {
  const rows = await sql()`select notion_page_id, unit_name, salesperson, visit_date, needs_follow_up, follow_up_closed, status from visits`
  return rows.map((r: any) => ({ id: r.notion_page_id, name: s(r.unit_name), sp: s(r.salesperson), date: d(r.visit_date), need: !!r.needs_follow_up, done: !!r.follow_up_closed, status: s(r.status) }))
}

export async function dbScanVisitRecency(): Promise<Record<string, string>> {
  const rows = await sql()`select replace(customer_notion_id,'-','') cid, max(visit_date) last from visits where customer_notion_id is not null and visit_date is not null group by 1`
  return Object.fromEntries(rows.map((r: any) => [r.cid, d(r.last)]))
}

export async function dbScanCustomerVisitSignals(): Promise<Record<string, CustomerVisitSignal>> {
  const rows = await sql()`select customer_notion_id, visit_date, reaction, follow_up_closed, needs_follow_up, status, next_follow_up, next_action from visits where customer_notion_id is not null`
  const map: Record<string, CustomerVisitSignal> = {}
  for (const r of rows as any[]) {
    const relId = bareId(r.customer_notion_id)
    const date = d(r.visit_date), reaction = s(r.reaction), status = s(r.status), nextDate = d(r.next_follow_up)
    const hit = map[relId] ?? (map[relId] = { lastVisit: '', visitCount: 0, lastReaction: '', lastReactionDate: '', openFollowUp: null })
    hit.visitCount++
    if (date > hit.lastVisit) hit.lastVisit = date
    if (reaction && date >= hit.lastReactionDate) { hit.lastReaction = reaction; hit.lastReactionDate = date }
    const isOpen = !r.follow_up_closed && (r.needs_follow_up || status === '追蹤中') && !COMPLETE.includes(status)
    if (isOpen) {
      const cand = { date, nextDate, action: s(r.next_action) }
      const kept = hit.openFollowUp
      const better = !kept || (!!cand.nextDate && !kept.nextDate)
        || (!!cand.nextDate === !!kept.nextDate && (cand.nextDate || cand.date) < (kept.nextDate || kept.date))
      if (better) hit.openFollowUp = cand
    }
  }
  return map
}

export async function dbScanVisitClaimSignals(): Promise<Record<string, VisitClaimSignal>> {
  const rows = await sql()`select replace(customer_notion_id,'-','') cid, salesperson, count(*)::int n, max(visit_date) last
    from visits where customer_notion_id is not null and salesperson is not null and salesperson <> '' group by 1,2`
  const map: Record<string, VisitClaimSignal> = {}
  for (const r of rows as any[]) {
    const hit = map[r.cid] ?? (map[r.cid] = { visitors: {}, lastDate: '' })
    hit.visitors[r.salesperson] = r.n
    const last = d(r.last)
    if (last > hit.lastDate) hit.lastDate = last
  }
  return map
}

export async function dbListVisitTallies(from: string, to: string, salesperson?: string): Promise<{ date: string; salesperson: string }[]> {
  const rows = await sql()`select visit_date, salesperson from visits where visit_date >= ${from} and visit_date <= ${to} and (${salesperson ?? null}::text is null or salesperson = ${salesperson ?? null})`
  return rows.map((r: any) => ({ date: d(r.visit_date), salesperson: s(r.salesperson) }))
}

/** 表單選項：資料裡實際出現過的標籤／競品／業務 */
export async function dbVisitDistinctValues(): Promise<{ tags: string[]; competitors: string[]; salespersons: string[] }> {
  const db = sql()
  const [t, c, sp] = await Promise.all([
    db`select distinct unnest(customer_tags) v from visits`,
    db`select distinct unnest(competitors) v from visits`,
    db`select distinct salesperson v from visits where salesperson is not null and salesperson <> ''`,
  ])
  const vals = (rows: any[]) => rows.map((r) => s(r.v)).filter(Boolean)
  return { tags: vals(t), competitors: vals(c), salespersons: vals(sp) }
}

/** 儀表板：本月有客情的不重複客戶數（有關聯用客戶 id，無關聯用單位名稱） */
export async function dbActiveCustomersInRange(from: string, to: string): Promise<number> {
  const [r] = await sql()`select count(distinct coalesce(customer_notion_id, 'name:' || unit_name))::int n from visits where visit_date >= ${from} and visit_date <= ${to} and unit_name <> ''`
  return r.n
}

/** 待配對：沒有客戶關聯的客情（新到舊） */
export async function dbUnlinkedVisits(): Promise<{ id: string; name: string; sp: string; date: string }[]> {
  const rows = await sql()`select notion_page_id, unit_name, salesperson, visit_date from visits where customer_notion_id is null order by visit_date desc nulls last`
  return rows.map((r: any) => ({ id: r.notion_page_id, name: s(r.unit_name).trim(), sp: s(r.salesperson), date: d(r.visit_date) })).filter((r) => r.name)
}

/** ceo-stats 用的扁平統計列 */
export type DbVisitStat = {
  id: string; date: string; salesperson: string; customerName: string; interactionType: string; interactionPurpose: string
  customerReaction: string; followUpAction: string; needsFollowUp: boolean; nextFollowUpDate: string; content: string; city: string
}
const stat = (r: any): DbVisitStat => ({
  id: r.notion_page_id, date: d(r.visit_date), salesperson: s(r.salesperson), customerName: s(r.unit_name),
  interactionType: s(r.interaction_type), interactionPurpose: s(r.purpose), customerReaction: s(r.reaction),
  followUpAction: s(r.next_action), needsFollowUp: !!r.needs_follow_up, nextFollowUpDate: d(r.next_follow_up),
  content: s(r.content), city: s(r.c_county),
})
export async function dbVisitStatsInRange(from: string, to: string): Promise<DbVisitStat[]> {
  const rows = await sql().unsafe(`${SELECT} where v.visit_date >= $1 and v.visit_date <= $2 order by v.visit_date desc`, [from, to])
  return (rows as any[]).map(stat)
}
export async function dbOpenFollowUpStats(): Promise<DbVisitStat[]> {
  const rows = await sql().unsafe(`${SELECT} where v.needs_follow_up = true and v.follow_up_closed = false order by v.visit_date desc`)
  return (rows as any[]).map(stat)
}
export async function dbVisitCountInRange(from: string, to: string): Promise<number> {
  const [r] = await sql()`select count(*)::int n from visits where visit_date >= ${from} and visit_date <= ${to}`
  return r.n
}
