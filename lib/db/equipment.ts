/**
 * lib/db/equipment.ts — 客戶設備（Supabase）。2026-11-10 自 Notion 搬遷。id 沿用 Notion 頁面 id；新設備為 uuid。
 * 產品縮圖／名稱仍由 Notion 產品頁解析（產品未搬），由呼叫端處理。
 */
import { sql } from './client'
import { bareId } from './read-source'
import type { Equipment } from '@/types'

const s = (v: any) => (v ?? '') as string
const d10 = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

export type EquipmentRow = {
  id: string; customerUnit: string; customerId: string; productId: string; serialNumber: string; manufacturer: string; status: string
  supportId: string; teamViewerId: string; dongleSerial: string; note: string; warrantyEnd: string; activationDate: string
}
const row = (r: any): EquipmentRow => ({
  id: r.notion_page_id, customerUnit: s(r.customer_unit), customerId: s(r.customer_notion_id), productId: s(r.product_notion_id),
  serialNumber: s(r.serial_number), manufacturer: s(r.manufacturer), status: s(r.status), supportId: s(r.support_id), teamViewerId: s(r.teamviewer_id),
  dongleSerial: s(r.dongle_serial), note: s(r.note), warrantyEnd: d10(r.warranty_end), activationDate: d10(r.activation_date),
})

export async function dbSearchEquipment(keyword: string): Promise<Equipment[]> {
  const kw = keyword ? `%${keyword}%` : null
  const rows = await sql()`select * from equipment where ${kw}::text is null or customer_unit ilike ${kw} or serial_number ilike ${kw} or support_id ilike ${kw} or teamviewer_id ilike ${kw}
    order by notion_updated_at desc nulls last limit 20`
  return rows.map(row).map((e) => ({
    id: e.id, customerName: e.customerUnit, serialNumber: e.serialNumber, manufacturer: e.manufacturer, status: e.status,
    supportId: e.supportId, teamViewerId: e.teamViewerId, productName: e.productId ? '已綁定產品' : '', originalCustomerId: e.customerId, originalProductId: e.productId,
  }))
}

export async function dbListCustomerEquipment(customerId: string): Promise<EquipmentRow[]> {
  const rows = await sql()`select * from equipment where replace(customer_notion_id,'-','') = ${bareId(customerId)} order by notion_created_at`
  return rows.map(row)
}

export async function dbGetEquipmentById(id: string): Promise<EquipmentRow | null> {
  const r = await sql()`select * from equipment where replace(notion_page_id,'-','') = ${bareId(id)} limit 1`
  return r.length ? row(r[0]) : null
}

export async function dbUpdateEquipment(id: string, data: { status?: string; serialNumber?: string; supportId?: string; teamViewerId?: string; dongleSerial?: string; note?: string; warrantyEnd?: string; activationDate?: string }): Promise<void> {
  const c: Record<string, any> = {}
  const nul = (v: any) => (v === '' || v === undefined ? null : v)
  if (data.status !== undefined) c.status = nul(data.status)
  if (data.serialNumber !== undefined) c.serial_number = data.serialNumber ?? ''
  if (data.supportId !== undefined) c.support_id = data.supportId ?? ''
  if (data.teamViewerId !== undefined) c.teamviewer_id = data.teamViewerId ?? ''
  if (data.dongleSerial !== undefined) c.dongle_serial = data.dongleSerial ?? ''
  if (data.note !== undefined) c.note = data.note ?? ''
  if (data.warrantyEnd !== undefined) c.warranty_end = nul(data.warrantyEnd)
  if (data.activationDate !== undefined) c.activation_date = nul(data.activationDate)
  if (!Object.keys(c).length) return
  c.notion_updated_at = new Date().toISOString()
  const r = await sql()`update equipment set ${sql()(c)} where replace(notion_page_id,'-','') = ${bareId(id)}`
  if (r.count === 0) throw new Error('找不到這台設備')
}

export async function dbEquipmentCustomerCounts(): Promise<Record<string, number>> {
  const rows = await sql()`select replace(customer_notion_id,'-','') cid, count(*)::int n from equipment where customer_notion_id is not null group by 1`
  return Object.fromEntries(rows.map((r: any) => [r.cid, r.n]))
}
