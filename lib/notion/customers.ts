/**
 * lib/notion/customers.ts — 客戶主檔（葉領域，從 system-notion.ts 抽出）
 * 只負責客戶 DB 的查詢/建立/狀態更新；「某客戶的設備/活動」歸各自領域（equipment/events）。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry, querySummary,
  getCachedValue, setCachedValue, getRedisValue, setRedisValue, deleteRedisValue,
  getProp, getTitle, getText, getSelect, getNumber,
} from './shared'
import { INACTIVE_SALESPERSONS } from '@/lib/line-salesperson-map'

export async function listAllSystemCustomers(): Promise<{ id: string; name: string; city: string; type: string }[]> {
  if (!DB.customers) return []
  const cacheKey = 'all-system-customers'
  const cached = getCachedValue<{ id: string; name: string; city: string; type: string }[]>(cacheKey)
  if (cached) return cached

  const { rows } = await querySummary(DB.customers, 200)
  const items = rows.map((page: any) => ({
    id: page.id,
    name: getTitle(page, '客戶名稱'),
    city: getSelect(page, '縣市'),
    type: getSelect(page, '客戶類型'),
  })).filter((c: any) => c.name)

  setCachedValue(cacheKey, items, 300_000) // cache 5 min
  return items
}

export type SystemCustomerDetail = {
  id: string
  name: string
  city: string
  district: string
  type: string
  status: string
  address: string
  phone: string
  taxId: string
  institutionCode: string
  dentistCount: number
  technicianCount: number
  technicianTraineeCount: number
}

export async function getSystemCustomerById(id: string): Promise<SystemCustomerDetail | null> {
  try {
    const page: any = await notionCallWithRetry('getSystemCustomerById', () =>
      notion.pages.retrieve({ page_id: id })
    )
    return {
      id: page.id,
      name: getTitle(page, '客戶名稱'),
      city: getSelect(page, '縣市'),
      district: getSelect(page, '行政區') || getText(page, '行政區'),
      type: getSelect(page, '客戶類型'),
      status: getSelect(page, '機構狀態'),
      address: getText(page, '地址'),
      phone: page.properties?.['電話']?.phone_number ?? getText(page, '電話'),
      taxId: getText(page, '統一編號'),
      institutionCode: getText(page, '機構代碼'),
      dentistCount: getNumber(page, '牙醫師數'),
      technicianCount: getNumber(page, '牙體技術師數'),
      technicianTraineeCount: getNumber(page, '牙體技術生數量'),
    }
  } catch {
    return null
  }
}

export type CustomerSearchResult = {
  id: string; name: string; city: string; district: string
  address: string; type: string; salesperson: string
}

export async function searchSystemCustomers(
  query: string,
  filters?: { city?: string; district?: string; salesperson?: string; type?: string }
): Promise<CustomerSearchResult[]> {
  if (!DB.customers) return []
  const keyword = query.trim()
  const hasFilters = !!(filters?.city || filters?.district || filters?.salesperson || filters?.type)
  if (!keyword && !hasFilters) return []

  const cacheKey = `sys-customers:${keyword}:${JSON.stringify(filters ?? {})}`.toLowerCase()
  const cached = getCachedValue<CustomerSearchResult[]>(cacheKey)
  if (cached) return cached

  const clauses: any[] = []

  if (keyword) {
    clauses.push({
      or: [
        { property: '客戶名稱', title:     { contains: keyword } },
        { property: '行政區',   rich_text: { contains: keyword } },
        { property: '地址',     rich_text: { contains: keyword } },
      ],
    })
  }

  if (filters?.city)        clauses.push({ property: '縣市',   select:    { equals: filters.city } })
  if (filters?.district)    clauses.push({ property: '行政區', rich_text: { equals: filters.district } })
  if (filters?.salesperson) clauses.push({ property: '負責業務', select:  { equals: filters.salesperson } })
  if (filters?.type)        clauses.push({ property: '客戶類型', select:  { equals: filters.type } })

  const notionFilter = clauses.length === 1 ? clauses[0] : { and: clauses }

  const response: any = await notionCallWithRetry('searchSystemCustomers', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.customers!),
      page_size: 30,
      filter: notionFilter,
      sorts: [{ property: '客戶名稱', direction: 'ascending' }],
    })
  )

  const items: CustomerSearchResult[] = (response.results ?? []).map((page: any) => ({
    id: page.id,
    name: getTitle(page, '客戶名稱'),
    city: getSelect(page, '縣市'),
    district: getSelect(page, '行政區') || getText(page, '行政區'),
    address: getText(page, '地址'),
    type: getSelect(page, '客戶類型'),
    salesperson: getSelect(page, '負責業務'),
  }))

  if (keyword) {
    const kw = keyword.toLowerCase()
    items.sort((a, b) => {
      const aNameMatch = a.name.toLowerCase().includes(kw) ? 0 : 1
      const bNameMatch = b.name.toLowerCase().includes(kw) ? 0 : 1
      if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch
      return a.name.localeCompare(b.name, 'zh-TW')
    })
  }

  setCachedValue(cacheKey, items, 180_000) // 3 min
  return items
}

export type CustomerListItem = {
  id: string
  name: string
  city: string
  district: string
  type: string
  salesperson: string
  status: string
}

/**
 * 一次拉取所有系統客戶（輕量欄位），快取 5 分鐘。
 * 前端用於 client-side 即時搜尋，避免每次打字都打 Notion API。
 */
export async function getAllSystemCustomers(): Promise<CustomerListItem[]> {
  if (!DB.customers) return []
  const cacheKey = 'all-system-customers-v1'
  const cached = getCachedValue<CustomerListItem[]>(cacheKey)
  if (cached) return cached

  const items: CustomerListItem[] = []
  let cursor: string | undefined
  do {
    const response: any = await notionCallWithRetry('getAllSystemCustomers', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.customers!),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        sorts: [{ property: '客戶名稱', direction: 'ascending' }],
      })
    )
    for (const page of response.results ?? []) {
      const name = getTitle(page, '客戶名稱')
      if (!name) continue
      items.push({
        id: page.id,
        name,
        city:        getSelect(page, '縣市'),
        district:    getSelect(page, '行政區') || getText(page, '行政區'),
        type:        getSelect(page, '客戶類型'),
        salesperson: getSelect(page, '負責業務'),
        status:      getSelect(page, '機構狀態'),
      })
    }
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  setCachedValue(cacheKey, items, 300_000) // 5 min
  return items
}

export async function listSystemCustomersPaginated(options?: {
  limit?: number
  cursor?: string
}): Promise<{ items: CustomerListItem[]; hasMore: boolean; nextCursor: string | null }> {
  if (!DB.customers) return { items: [], hasMore: false, nextCursor: null }
  const limit = options?.limit ?? 10
  const startCursor = options?.cursor

  const response: any = await notionCallWithRetry('listSystemCustomersPaginated', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.customers!),
      page_size: limit,
      sorts: [{ property: '客戶名稱', direction: 'ascending' }],
      ...(startCursor ? { start_cursor: startCursor } : {}),
    })
  )

  const items: CustomerListItem[] = []
  for (const page of response.results ?? []) {
    const name = getTitle(page, '客戶名稱')
    if (!name) continue
    items.push({
      id: page.id,
      name,
      city:        getSelect(page, '縣市'),
      district:    getSelect(page, '行政區') || getText(page, '行政區'),
      type:        getSelect(page, '客戶類型'),
      salesperson: getSelect(page, '負責業務'),
      status:      getSelect(page, '機構狀態'),
    })
  }

  return {
    items,
    hasMore: response.has_more ?? false,
    nextCursor: response.next_cursor ?? null,
  }
}

// ── 醫事監控用：載入所有有機構代碼的客戶（含代碼欄位）──────────────────
export interface CustomerWithCode {
  id:              string
  name:            string
  city:            string
  district:        string
  type:            string
  status:          string
  institutionCode: string
}

export async function getCustomersWithCodes(): Promise<CustomerWithCode[]> {
  if (!DB.customers) return []
  const cacheKey = 'customers-with-codes-v1'
  const cached = await getRedisValue<CustomerWithCode[]>(cacheKey)
  if (cached) return cached

  const items: CustomerWithCode[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('getCustomersWithCodes', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.customers!),
        page_size:   100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      const name = getTitle(page, '客戶名稱')
      if (!name) continue
      items.push({
        id:              page.id,
        name,
        city:            getSelect(page, '縣市'),
        district:        getSelect(page, '行政區') || getText(page, '行政區'),
        type:            getSelect(page, '客戶類型'),
        status:          getSelect(page, '機構狀態'),
        institutionCode: getText(page, '機構代碼'),
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  await setRedisValue(cacheKey, items, 60 * 60_000) // 1 hr
  return items
}

// ── 業務開發：開發階段（漏斗）────────────────────────────────────────────
// 機構狀態＝營業狀態（醫事監控領域專用）；開發階段＝業務關係狀態（業務領域專用）。
// 兩者嚴格分離，禁止把「潛在客戶」之類的業務語意塞回機構狀態。
export const DEV_STAGES = ['線索', '已接觸', '試用中', '報價中', '已成交', '流失'] as const
export type DevStage = (typeof DEV_STAGES)[number]

export interface PipelineCustomer {
  id:          string
  name:        string
  city:        string
  district:    string
  type:        string
  status:      string   // 機構狀態（營業狀態）
  salesperson: string   // 負責業務（＝認領人）
  devStage:    string
  devSource:   string
  lastEdited:  string   // 最後編輯時間（判斷停滯天數用）
}

/** 列出所有在開發漏斗中的客戶（開發階段非空） */
export async function listPipelineCustomers(): Promise<PipelineCustomer[]> {
  if (!DB.customers) return []
  const cacheKey = 'pipeline-customers-v1'
  const cached = getCachedValue<PipelineCustomer[]>(cacheKey)
  if (cached) return cached

  const items: PipelineCustomer[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listPipelineCustomers', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.customers!),
        page_size: 100,
        filter: { property: '開發階段', select: { is_not_empty: true } },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      const name = getTitle(page, '客戶名稱')
      if (!name) continue
      items.push({
        id:          page.id,
        name,
        city:        getSelect(page, '縣市'),
        district:    getSelect(page, '行政區') || getText(page, '行政區'),
        type:        getSelect(page, '客戶類型'),
        status:      getSelect(page, '機構狀態'),
        salesperson: getSelect(page, '負責業務'),
        devStage:    getSelect(page, '開發階段'),
        devSource:   getSelect(page, '開發來源'),
        lastEdited:  page.last_edited_time ?? '',
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  setCachedValue(cacheKey, items, 60_000) // 1 min（看板要即時感）
  return items
}

/** 更新客戶的開發階段/來源/負責業務（認領）。stage 傳 null 表示移出漏斗。 */
export async function updateCustomerDevStage(
  id: string,
  data: { devStage?: string | null; devSource?: string; salesperson?: string }
): Promise<void> {
  // 防止任意 page_id 寫入：限定目標頁面必須屬於客戶主檔 DB
  const page = await notionCallWithRetry('updateCustomerDevStage:checkOwner', () =>
    notion.pages.retrieve({ page_id: id })
  ) as any
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const customersDb = (DB.customers ?? '').replace(/-/g, '')
  if (!targetDb || targetDb !== customersDb) {
    throw new Error('customerId 不屬於客戶主檔，拒絕寫入')
  }
  if (data.devStage !== undefined && data.devStage !== null && !DEV_STAGES.includes(data.devStage as DevStage)) {
    throw new Error(`無效的開發階段：${data.devStage}`)
  }
  const properties: any = {}
  if (data.devStage !== undefined) {
    properties['開發階段'] = data.devStage ? { select: { name: data.devStage } } : { select: null }
  }
  if (data.devSource)    properties['開發來源'] = { select: { name: data.devSource } }
  if (data.salesperson)  properties['負責業務'] = { select: { name: data.salesperson } }
  if (Object.keys(properties).length === 0) return
  await notionCallWithRetry('updateCustomerDevStage', () =>
    notion.pages.update({ page_id: id, properties })
  )
  setCachedValue('pipeline-customers-v1', null as any, 1) // 失效看板快取
}

// ── 醫事監控用：建立新客戶 ───────────────────────────────────────────────
export async function createSystemCustomer(data: {
  name:            string
  city:            string
  district:        string
  address:         string
  phone?:          string
  institutionCode: string
  type:            string  // 客戶類型 select value
  status?:         string  // 機構狀態 select value, default '開業'
  note?:           string
  nhiContract?:    boolean // 健保特約 checkbox
  infoUrl?:        string  // 機構資料（衛福部機構基本資料頁）
  personnelUrl?:   string  // 醫事人員連結
  deptUrl?:        string  // 診療科別連結
  devStage?:       string  // 開發階段（業務開發漏斗；醫事監控匯入預設 '線索'）
  devSource?:      string  // 開發來源
}): Promise<{ id: string }> {
  if (!DB.customers) throw new Error('NOTION_CUSTOMERS_SYSTEM_DB 未設定')
  const page: any = await notionCallWithRetry('createSystemCustomer', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.customers!) },
      properties: {
        '客戶名稱':  { title:     [{ text: { content: data.name } }] },
        '縣市':      { select:    { name: data.city } },
        '行政區':    { rich_text: [{ text: { content: data.district } }] },
        '地址':      { rich_text: [{ text: { content: data.address } }] },
        '機構代碼':  { rich_text: [{ text: { content: data.institutionCode } }] },
        '客戶類型':  { select:    { name: data.type } },
        '機構狀態':  { select:    { name: data.status ?? '開業' } },
        ...(data.phone ? { '電話': { phone_number: data.phone } } : {}),
        ...(typeof data.nhiContract === 'boolean' ? { '健保特約': { checkbox: data.nhiContract } } : {}),
        ...(data.infoUrl      ? { '機構資料':     { url: data.infoUrl } }      : {}),
        ...(data.personnelUrl ? { '醫事人員連結': { url: data.personnelUrl } } : {}),
        ...(data.deptUrl      ? { '診療科別連結': { url: data.deptUrl } }      : {}),
        ...(data.devStage     ? { '開發階段':     { select: { name: data.devStage } } }  : {}),
        ...(data.devSource    ? { '開發來源':     { select: { name: data.devSource } } } : {}),
      } as any,
    })
  )
  // invalidate cache
  try { await setRedisValue('customers-with-codes-v1', null, 1) } catch {}
  return { id: page.id }
}

// ── 醫事監控用：更新客戶「機構狀態」（開業/停業/已歇業/撤銷/狀況不明）──────────
export async function updateCustomerStatus(id: string, status: string): Promise<void> {
  // 防止任意 page_id 寫入：限定目標頁面必須屬於客戶主檔 DB
  const page = await notionCallWithRetry('updateCustomerStatus:checkOwner', () =>
    notion.pages.retrieve({ page_id: id })
  ) as any
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const customersDb = (DB.customers ?? '').replace(/-/g, '')
  if (!targetDb || targetDb !== customersDb) {
    throw new Error('customerId 不屬於客戶主檔，拒絕寫入')
  }
  await notionCallWithRetry('updateCustomerStatus', () =>
    notion.pages.update({ page_id: id, properties: { '機構狀態': { select: { name: status } } } as any })
  )
  // 失效客戶快取，使下次比對讀到新狀態
  deleteRedisValue('customers-with-codes-v1')
}

export async function getCustomerFilterOptions(): Promise<{
  cities: string[]; districtsByCity: Record<string, string[]>; salespersons: string[]; types: string[]
}> {
  if (!DB.customers) return { cities: [], districtsByCity: {}, salespersons: [], types: [] }
  const cacheKey = 'customer-filter-options-v2'
  const cached = getCachedValue<{ cities: string[]; districtsByCity: Record<string, string[]>; salespersons: string[]; types: string[] }>(cacheKey)
  if (cached) return cached

  // ── Step 1: schema → cities, salespersons, types (selects) ──
  let cities: string[] = []
  let salespersons: string[] = []
  let types: string[] = []
  try {
    const db: any = await notionCallWithRetry('getCustomerFilterOptions:schema', () =>
      notion.databases.retrieve({ database_id: normalizeDatabaseId(DB.customers!) })
    )
    const opts = (propName: string): string[] =>
      (db.properties?.[propName]?.select?.options ?? []).map((o: any) => o.name).filter(Boolean)
    cities      = opts('縣市')
    salespersons = opts('負責業務').filter((s) => !INACTIVE_SALESPERSONS.has(s))
    types       = opts('客戶類型')
  } catch { /* return what we have */ }

  // ── Step 2: query records to build city → districts[] map ──
  const districtsByCity: Record<string, string[]> = {}
  try {
    let cursor: string | undefined
    do {
      const response: any = await notionCallWithRetry('getCustomerFilterOptions:pages', () =>
        notion.databases.query({
          database_id: normalizeDatabaseId(DB.customers!),
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        })
      )
      for (const page of response.results ?? []) {
        const city     = getSelect(page, '縣市')
        const district = getText(page, '行政區')
        if (city && district) {
          if (!districtsByCity[city]) districtsByCity[city] = []
          if (!districtsByCity[city].includes(district)) districtsByCity[city].push(district)
        }
      }
      cursor = response.has_more ? response.next_cursor : undefined
    } while (cursor)
    Object.values(districtsByCity).forEach((arr) => arr.sort())
  } catch { /* districtsByCity stays partial — that's OK */ }

  const result = { cities, districtsByCity, salespersons, types }
  setCachedValue(cacheKey, result, 300_000)
  return result
}
