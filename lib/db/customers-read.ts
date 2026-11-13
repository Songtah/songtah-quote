/**
 * lib/db/customers-read.ts — 客戶主檔的資料庫讀取（Supabase），形狀與 lib/notion/customers.ts 一致。
 * id 一律回 Notion 頁面 id（notion_page_id），讓所有既有畫面、網址與其他 Notion 庫的關聯不變。
 */
import { sql } from './client'
import { bareId } from './read-source'
import { canonicalSalespersonName, salespersonNameVariants } from '@/lib/salesperson-name'
import { isInactiveCustomer } from '@/lib/customer-status'
import { TW_CITIES } from '@/lib/tw-districts'
import type {
  SystemCustomerDetail, CustomerSearchResult, CustomerListItem, AreaCustomer,
  CustomerWithCode, RegionStatRow, RegionStatsResult, PipelineCustomer,
} from '@/lib/notion/customers'

const zh = (a: string, b: string) => a.localeCompare(b, 'zh-TW')
const s = (v: any) => (v ?? '') as string
const n = (v: any) => (typeof v === 'number' ? v : v == null ? 0 : Number(v) || 0)

/** 依頁面 id 找一筆（兩種連字號寫法都接受） */
async function rowById(id: string) {
  const r = await sql()`select * from customers where replace(notion_page_id, '-', '') = ${bareId(id)} limit 1`
  return r[0] ?? null
}

export async function dbGetSystemCustomerById(id: string): Promise<SystemCustomerDetail | null> {
  const r = await rowById(id)
  if (!r) return null
  return {
    id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district), type: s(r.customer_type),
    status: s(r.institution_status), address: s(r.address), phone: s(r.phone), taxId: '',
    institutionCode: s(r.institution_code), dentistCount: n(r.dentist_count), technicianCount: n(r.technician_count),
    technicianTraineeCount: n(r.trainee_count), salesperson: s(r.owner), devStage: s(r.dev_stage),
  }
}

export async function dbSearchSystemCustomers(
  keyword: string, filters?: { city?: string; district?: string; salesperson?: string; type?: string },
): Promise<CustomerSearchResult[]> {
  const db = sql()
  const kw = keyword ? `%${keyword}%` : null
  const rows = await db`
    select notion_page_id, name, county, district, address, customer_type, owner from customers
    where (${kw}::text is null or name ilike ${kw} or district ilike ${kw} or address ilike ${kw})
      and (${filters?.city ?? null}::text is null or county = ${filters?.city ?? null})
      and (${filters?.district ?? null}::text is null or district = ${filters?.district ?? null})
      and (${filters?.salesperson ?? null}::text is null or owner = ${filters?.salesperson ?? null})
      and (${filters?.type ?? null}::text is null or customer_type = ${filters?.type ?? null})
    order by name limit 30`
  const items: CustomerSearchResult[] = rows.map((r: any) => ({
    id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district),
    address: s(r.address), type: s(r.customer_type), salesperson: s(r.owner),
  }))
  if (keyword) {
    const k = keyword.toLowerCase()
    items.sort((a, b) => {
      const am = a.name.toLowerCase().includes(k) ? 0 : 1, bm = b.name.toLowerCase().includes(k) ? 0 : 1
      return am - bm || zh(a.name, b.name)
    })
  } else items.sort((a, b) => zh(a.name, b.name))
  return items
}

const listItem = (r: any): CustomerListItem => ({
  id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district),
  type: s(r.customer_type), salesperson: s(r.owner), status: s(r.institution_status),
})

export async function dbGetAllSystemCustomers(): Promise<CustomerListItem[]> {
  const rows = await sql()`select notion_page_id, name, county, district, customer_type, owner, institution_status from customers where name <> ''`
  return rows.map(listItem).sort((a, b) => zh(a.name, b.name))
}

/** cursor＝「o:<offset>」 */
export async function dbListSystemCustomersPaginated(options?: { limit?: number; cursor?: string }) {
  const limit = options?.limit ?? 10
  const offset = options?.cursor?.startsWith('o:') ? Number(options.cursor.slice(2)) || 0 : 0
  const rows = await sql()`select notion_page_id, name, county, district, customer_type, owner, institution_status
    from customers where name <> '' order by name collate "C", notion_page_id limit ${limit + 1} offset ${offset}`
  const hasMore = rows.length > limit
  return { items: rows.slice(0, limit).map(listItem), hasMore, nextCursor: hasMore ? `o:${offset + limit}` : null }
}

const AREA_EMPTY = new Set(['(未填縣市)', '(未填行政區)'])
const AREA_MAIN_TYPES = ['牙醫診所', '牙體技術所', '醫院']
const AREA_STATUS_EMPTY = '(空白)'

const areaCustomer = (r: any): AreaCustomer => ({
  id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district), type: s(r.customer_type),
  status: s(r.institution_status), address: s(r.address), phone: s(r.phone),
  salesperson: canonicalSalespersonName(s(r.owner)), devStage: s(r.dev_stage), institutionCode: s(r.institution_code),
})

export async function dbListCustomersByArea(f: {
  city?: string; district?: string; salesperson?: string; type?: string; status?: string; devStage?: string
  unassignedOnly?: boolean; excludeClosed?: boolean; excludePersonal?: boolean
}): Promise<AreaCustomer[]> {
  const db = sql()
  const cityEmpty = !!f.city && AREA_EMPTY.has(f.city), distEmpty = !!f.district && AREA_EMPTY.has(f.district)
  const city = f.city && !cityEmpty ? f.city : null, district = f.district && !distEmpty ? f.district : null
  const owners = !f.unassignedOnly && f.salesperson ? salespersonNameVariants(f.salesperson) : null
  const otherTypes = f.type === '其他'
  const type = f.type && !otherTypes ? f.type : null
  const statusEmpty = f.status === AREA_STATUS_EMPTY
  const status = f.status && !statusEmpty ? f.status : null
  const rows = await db`
    select notion_page_id, name, county, district, customer_type, institution_status, address, phone, owner, dev_stage, institution_code
    from customers where name <> ''
      and (${city}::text is null or county = ${city}) and (${!cityEmpty} or county is null or county = '')
      and (${district}::text is null or district = ${district}) and (${!distEmpty} or district is null or district = '')
      and (${!f.unassignedOnly} or owner is null or owner = '')
      and (${owners}::text[] is null or owner = any(${owners}))
      and (${type}::text is null or customer_type = ${type})
      and (${status}::text is null or institution_status = ${status}) and (${!statusEmpty} or institution_status is null or institution_status = '')
      and (${f.devStage ?? null}::text is null or dev_stage = ${f.devStage ?? null})`
  return rows.map(areaCustomer)
    .filter((c) => (!otherTypes || !AREA_MAIN_TYPES.includes(c.type)) && (!f.excludeClosed || !isInactiveCustomer(c.status)) && (!f.excludePersonal || c.type !== '個人'))
    .sort((a, b) => zh(a.name, b.name))
}

export async function dbListCustomersByAreas(areas: { city: string; district: string }[]): Promise<AreaCustomer[]> {
  const uniq = Array.from(new Map(areas.filter((a) => a.city && a.district).map((a) => [`${a.city}|${a.district}`, a])).values())
  if (!uniq.length) return []
  const db = sql()
  const rows = await db`
    select notion_page_id, name, county, district, customer_type, institution_status, address, phone, owner, dev_stage, institution_code
    from customers where name <> '' and (county, district) in (select * from unnest(${uniq.map((a) => a.city)}::text[], ${uniq.map((a) => a.district)}::text[]))`
  return rows.map(areaCustomer).sort((a, b) => zh(a.name, b.name))
}

/** 篩選選項：縣市／負責業務／客戶類型取資料裡實際出現過的值（Notion 選項清單已封存） */
export async function dbCustomerFilterOptions(): Promise<{ cities: string[]; salespersons: string[]; types: string[] }> {
  const rows = await sql()`select
    array(select distinct county from customers where coalesce(county,'') <> '') as cities,
    array(select distinct owner from customers where coalesce(owner,'') <> '') as owners,
    array(select distinct customer_type from customers where coalesce(customer_type,'') <> '') as types`
  const r: any = rows[0] ?? {}
  const order = (c: string) => { const i = TW_CITIES.indexOf(c.replace(/臺/g, '台')); return i < 0 ? 999 : i }
  return { cities: (r.cities ?? []).sort((a: string, b: string) => order(a) - order(b) || zh(a, b)), salespersons: (r.owners ?? []).sort(zh), types: (r.types ?? []).sort(zh) }
}

export async function dbGetCustomersWithCodes(): Promise<CustomerWithCode[]> {
  const rows = await sql()`select notion_page_id, name, county, district, customer_type, institution_status, dev_stage, dev_status_tags, owner, institution_code, technician_count, trainee_count from customers where name <> ''`
  return rows.map((r: any) => ({
    id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district), type: s(r.customer_type),
    status: s(r.institution_status), devStage: s(r.dev_stage), devStatus: (r.dev_status_tags ?? []) as string[],
    salesperson: s(r.owner), institutionCode: s(r.institution_code),
    technicianCount: n(r.technician_count), technicianTraineeCount: n(r.trainee_count),
  }))
}

export async function dbGetRegionStatsRows(): Promise<RegionStatsResult> {
  const rows = await sql()`
    select coalesce(nullif(county,''), '(未填縣市)') city, coalesce(nullif(district,''), '(未填行政區)') district,
           coalesce(nullif(customer_type,''), '(未分類)') type, coalesce(nullif(institution_status,''), '(空白)') status,
           coalesce(owner,'') salesperson, coalesce(dev_stage,'') dev_stage, count(*)::int count
    from customers where name <> '' group by 1,2,3,4,5,6`
  const out: RegionStatRow[] = rows.map((r: any) => ({ city: r.city, district: r.district, type: r.type, status: r.status, salesperson: r.salesperson, devStage: r.dev_stage, count: r.count }))
  return { rows: out, updatedAt: new Date().toISOString() }
}

export async function dbListPipelineCustomers(): Promise<PipelineCustomer[]> {
  const rows = await sql()`select notion_page_id, name, county, district, customer_type, institution_status, owner, dev_stage, dev_source, notion_updated_at from customers where name <> '' and dev_stage is not null and dev_stage <> ''`
  return rows.map((r: any) => ({
    id: r.notion_page_id, name: s(r.name), city: s(r.county), district: s(r.district), type: s(r.customer_type),
    status: s(r.institution_status), salesperson: s(r.owner), devStage: s(r.dev_stage), devSource: s(r.dev_source),
    lastEdited: r.notion_updated_at ? new Date(r.notion_updated_at).toISOString() : '',
  }))
}

/** 給 relations.resolveCustomerInfo 用：一批 id → 名稱／縣市／行政區 */
export async function dbResolveCustomerInfo(ids: string[]): Promise<Record<string, { name: string; city: string; district: string }>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  const out: Record<string, { name: string; city: string; district: string }> = {}
  if (!uniq.length) return out
  const bare = uniq.map(bareId)
  const rows = await sql()`select notion_page_id, name, county, district from customers where replace(notion_page_id,'-','') = any(${bare})`
  const byBare = new Map(rows.map((r: any) => [bareId(r.notion_page_id), r]))
  for (const id of uniq) {
    const r = byBare.get(bareId(id))
    out[id] = r ? { name: s(r.name), city: s(r.county), district: s(r.district) } : { name: '', city: '', district: '' }
  }
  return out
}

/** 儀表板：客戶總數與最近建立 6 筆 */
export async function dbCustomersSummary(): Promise<{ total: number; recent: { id: string; title: string; meta: string }[] }> {
  const db = sql()
  const [c] = await db`select count(*)::int n from customers`
  const rows = await db`select notion_page_id, name, county, customer_type from customers order by notion_created_at desc nulls last limit 6`
  return { total: c.n, recent: rows.map((r: any) => ({ id: r.notion_page_id, title: s(r.name), meta: [s(r.county), s(r.customer_type)].filter(Boolean).join('・') })) }
}
