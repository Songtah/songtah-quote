/**
 * lib/db/tickets.ts — 技術支援工單（Supabase）。2026-11-10 自 Notion 搬遷。
 * 編號：RMA-n，由 ticket_number_seq 發號（接續 Notion 最大號）。id 沿用 Notion 頁面 id；新工單為 uuid。
 */
import { randomUUID } from 'crypto'
import { sql } from './client'
import { bareId } from './read-source'
import type { Ticket, CreateTicketPayload, UpdateTicketPayload } from '@/types'

const s = (v: any) => (v ?? '') as string
const d10 = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const isIso = (x: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x.trim())

const SELECT = `select t.*, c.name as c_name from tickets t left join customers c on replace(c.notion_page_id,'-','') = replace(t.customer_notion_id,'-','')`

function toTicket(r: any): Ticket & { customerId: string } {
  const raw = s(r.customer_unit)
  const fallback = isIso(raw) ? '' : raw
  const customerName = s(r.c_name) || fallback
  return {
    id: r.notion_page_id, customerId: s(r.customer_notion_id), equipmentId: s(r.equipment_notion_id), number: r.number != null ? `RMA-${r.number}` : '',
    customerName, title: s(r.title) || customerName,
    ticketType: ((r.fault_types ?? []) as string[]).join(', '), status: s(r.status), priority: s(r.priority),
    scheduledDate: d10(r.scheduled_date), contactName: s(r.contact_name), description: s(r.description),
    supportOwner: s(r.support_owner), salesOwner: s(r.sales_owner), cause: s(r.cause), solution: s(r.solution), note: s(r.note),
    manufacturer: s(r.manufacturer), createdDate: d10(r.created_date),
  }
}

export async function dbListCustomerTickets(customerId: string): Promise<Ticket[]> {
  const rows = await sql().unsafe(`${SELECT} where replace(t.customer_notion_id,'-','') = $1 order by t.created_date desc nulls last, t.number desc limit 50`, [bareId(customerId)])
  return (rows as any[]).map(toTicket)
}
export async function dbListEquipmentTickets(equipmentId: string): Promise<Ticket[]> {
  const rows = await sql().unsafe(`${SELECT} where replace(t.equipment_notion_id,'-','') = $1 order by t.created_date desc nulls last, t.number desc limit 50`, [bareId(equipmentId)])
  return (rows as any[]).map(toTicket)
}
export async function dbGetTicketById(id: string): Promise<(Ticket & { customerId: string }) | null> {
  const rows = await sql().unsafe(`${SELECT} where replace(t.notion_page_id,'-','') = $1 limit 1`, [bareId(id)])
  return rows.length ? toTicket(rows[0]) : null
}
export async function dbListTickets(opts: { limit: number; offset: number; salesOwner?: string }): Promise<{ items: Ticket[]; hasMore: boolean }> {
  const rows = await sql().unsafe(`${SELECT} where ($1::text is null or t.sales_owner = $1) order by t.created_date desc nulls last, t.number desc limit ${opts.limit + 1} offset ${opts.offset}`, [opts.salesOwner ?? null])
  return { items: (rows as any[]).slice(0, opts.limit).map(toTicket), hasMore: rows.length > opts.limit }
}
export async function dbOpenTicketsForSla(): Promise<{ id: string; priority: string; createdDate: string }[]> {
  const rows = await sql()`select notion_page_id, priority, created_date from tickets where coalesce(status,'') <> '✅ 結案'`
  return rows.map((r: any) => ({ id: r.notion_page_id, priority: s(r.priority), createdDate: d10(r.created_date) }))
}

const MANUFACTURER_MAP: Record<string, string> = { 'BSM 貝施美': 'BSM', Zirkonzahn: 'Zirkonzhan' }

export async function dbCreateTicket(p: CreateTicketPayload, createdDate: string): Promise<{ id: string; number: string }> {
  const db = sql()
  const [{ n }] = await db`select nextval('ticket_number_seq')::int n`
  const id = randomUUID()
  const now = new Date().toISOString()
  const row = {
    notion_page_id: id, number: n, customer_unit: p.customerName ?? '', customer_notion_id: p.customerId || null, equipment_notion_id: p.equipmentId || null,
    product_notion_id: p.productId || null, title: p.title || null, fault_types: p.ticketType ? [p.ticketType] : [], status: p.status || null, priority: p.priority || null,
    scheduled_date: p.scheduledDate || null, created_date: createdDate, contact_name: p.contactName || null, description: p.description || null,
    support_owner: p.supportOwner || null, sales_owner: p.salesOwner || null, cause: p.cause || null, solution: p.solution || null, key_part: p.keyPart || null,
    note: p.note || null, manufacturer: p.manufacturer ? (MANUFACTURER_MAP[p.manufacturer] ?? p.manufacturer) : null,
    notion_created_at: now, notion_updated_at: now,
  }
  await db`insert into tickets ${(db as any)([row], ...Object.keys(row))}`
  return { id, number: `RMA-${n}` }
}

export async function dbUpdateTicket(id: string, data: UpdateTicketPayload): Promise<void> {
  const c: Record<string, any> = {}
  const nul = (v: any) => (v === '' || v === undefined ? null : v)
  if (data.status !== undefined) c.status = nul(data.status)
  if (data.priority !== undefined) c.priority = nul(data.priority)
  if (data.supportOwner !== undefined) c.support_owner = nul(data.supportOwner)
  if (data.salesOwner !== undefined) c.sales_owner = nul(data.salesOwner)
  if (data.scheduledDate !== undefined) c.scheduled_date = nul(data.scheduledDate)
  if (data.cause !== undefined) c.cause = nul(data.cause)
  if (data.solution !== undefined) c.solution = nul(data.solution)
  if (data.note !== undefined) c.note = nul(data.note)
  if (data.equipmentId !== undefined) c.equipment_notion_id = nul(data.equipmentId)
  if (!Object.keys(c).length) return
  c.notion_updated_at = new Date().toISOString()
  const r = await sql()`update tickets set ${sql()(c)} where replace(notion_page_id,'-','') = ${bareId(id)}`
  if (r.count === 0) throw new Error('找不到這張工單')
}
