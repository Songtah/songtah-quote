/**
 * lib/db/customers-write.ts — 客戶主檔的資料庫寫入（2026-11-10 起客戶唯一來源；Notion 客戶庫封存）
 * 新客戶 id＝系統 uuid（36 字元，與 Notion 頁面 id 同格式），origin='db'；既有 10,393 筆沿用 Notion id。
 */
import { randomUUID } from 'crypto'
import { sql } from './client'
import { bareId } from './read-source'

export type CustomerRow = {
  id: string; name: string; city: string; district: string; type: string; status: string; address: string; phone: string
  institutionCode: string; owner: string; devStage: string; devSource: string; opportunityTags: string[]; hasLab: boolean
}
const s = (v: any) => (v ?? '') as string
const row = (r: any): CustomerRow => ({
  id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district), type: s(r.customer_type), status: s(r.institution_status),
  address: s(r.address), phone: s(r.phone), institutionCode: s(r.institution_code), owner: s(r.owner), devStage: s(r.dev_stage), devSource: s(r.dev_source),
  opportunityTags: (r.opportunity_tags ?? []) as string[], hasLab: !!r.has_lab,
})

/** 取一筆現況（寫入前的擁有權／空白檢查用）；找不到回 null */
export async function dbCustomerRow(id: string): Promise<CustomerRow | null> {
  const r = await sql()`select * from customers where replace(notion_page_id,'-','') = ${bareId(id)} limit 1`
  return r.length ? row(r[0]) : null
}

/** 更新指定欄位（鍵＝資料庫欄名）。回傳影響列數。 */
export async function dbUpdateCustomer(id: string, cols: Record<string, any>): Promise<number> {
  if (!Object.keys(cols).length) return 0
  const c = { ...cols, notion_updated_at: new Date().toISOString(), synced_at: new Date().toISOString() }
  const r = await sql()`update customers set ${sql()(c)} where replace(notion_page_id,'-','') = ${bareId(id)}`
  return r.count
}

export async function dbCreateCustomer(data: {
  name: string; city: string; district: string; address: string; phone?: string; institutionCode: string; type: string; status?: string
  nhiContract?: boolean; infoUrl?: string; personnelUrl?: string; deptUrl?: string; devStage?: string; devSource?: string
  dentistCount?: number; technicianCount?: number; technicianTraineeCount?: number
}): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const r = {
    notion_page_id: id, origin: 'db', name: data.name, county: data.city || null, district: data.district || null, address: data.address || null,
    phone: data.phone || null, institution_code: data.institutionCode || null, customer_type: data.type || null, institution_status: data.status ?? '開業',
    nhi_contracted: data.nhiContract === true, institution_url: data.infoUrl || null, staff_url: data.personnelUrl || null, departments_url: data.deptUrl || null,
    dev_stage: data.devStage || null, dev_source: data.devSource || null,
    dentist_count: typeof data.dentistCount === 'number' ? data.dentistCount : null,
    technician_count: typeof data.technicianCount === 'number' ? data.technicianCount : null,
    trainee_count: typeof data.technicianTraineeCount === 'number' ? data.technicianTraineeCount : null,
    notion_created_at: now, notion_updated_at: now, synced_at: now,
  }
  const db = sql()
  await db`insert into customers ${(db as any)([r], ...Object.keys(r))}`
  return id
}

// ── 商機標籤（opportunity.ts）────────────────────────────────────────────
export async function dbListOpportunityCustomers(f: { tag?: string; city?: string; district?: string; salesperson?: string; unclaimedOnly?: boolean }): Promise<CustomerRow[]> {
  const rows = await sql()`select * from customers where cardinality(opportunity_tags) > 0
    and (${f.tag ?? null}::text is null or ${f.tag ?? null} = any(opportunity_tags))
    and (${f.city ?? null}::text is null or county = ${f.city ?? null})
    and (${f.district ?? null}::text is null or district = ${f.district ?? null})
    and (${f.salesperson ?? null}::text is null or owner = ${f.salesperson ?? null})
    and (${!f.unclaimedOnly} or ((owner is null or owner = '') and (dev_stage is null or dev_stage = '')))`
  return rows.map(row)
}
export async function dbListDistrictClinics(city: string, district: string): Promise<CustomerRow[]> {
  const rows = await sql()`select * from customers where county = ${city} and district = ${district} and customer_type = '牙醫診所'`
  return rows.map(row)
}
export async function dbSearchActiveCustomers(keyword: string): Promise<CustomerRow[]> {
  const rows = await sql()`select * from customers where name ilike ${'%' + keyword + '%'} and coalesce(institution_status,'') not in ('已歇業','停業','撤銷') order by name limit 20`
  return rows.map(row)
}
