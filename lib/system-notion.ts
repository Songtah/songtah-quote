import bcrypt from 'bcryptjs'
import type { CreateTicketPayload, Equipment, Ticket } from '@/types'
import { INACTIVE_SALESPERSONS } from '@/lib/line-salesperson-map'
import { resolveCustomerInfo, resolveProductNames, resolveCustomerNames } from './notion/relations'
export { resolveCustomerInfo, resolveProductNames, resolveCustomerNames } from './notion/relations'

export type ModuleSummary = {
  total: number
  hasMore?: boolean           // true when actual record count exceeds the fetched page
  activeThisMonth?: number    // unique active customers in current month (CRM only)
  recent: Array<{
    id: string
    title: string
    meta: string
    href?: string
  }>
}

export type DashboardSummary = {
  customers: ModuleSummary
  tickets: ModuleSummary
  opportunities: ModuleSummary
  products: ModuleSummary
  users: ModuleSummary
}

// ── Notion 資料層共用基礎已抽離至 ./notion/shared（leaf module）─────────────────
// 以下 re-export 維持既有 `import { ... } from '@/lib/system-notion'` 路徑相容。
export {
  notion, transientCache, getRedis, getRedisValue, setRedisValue, deleteRedisValue,
  DB, normalizeDatabaseId, getProp, getTitle, getText, getSelect, getNumber, getDate,
  getRelationIds, getRollupText, richText, sleep, isRateLimited, notionCallWithRetry,
  getCachedValue, setCachedValue, querySummary,
} from './notion/shared'
import {
  notion, transientCache, getRedisValue, setRedisValue, deleteRedisValue,
  DB, normalizeDatabaseId, getProp, getTitle, getText, getSelect, getNumber, getDate,
  getRelationIds, getRollupText, richText, sleep, isRateLimited, notionCallWithRetry,
  getCachedValue, setCachedValue, querySummary,
} from './notion/shared'

// ─── 客戶主檔 → 已抽至 ./notion/customers（葉領域）──────────────────────────────
export type { SystemCustomerDetail, CustomerSearchResult, CustomerListItem, CustomerWithCode } from './notion/customers'
export {
  listAllSystemCustomers, getSystemCustomerById, searchSystemCustomers,
  getAllSystemCustomers, listSystemCustomersPaginated, getCustomersWithCodes,
  createSystemCustomer, updateCustomerStatus, getCustomerFilterOptions,
} from './notion/customers'

// ─── 工單 / RMA → 已抽至 ./notion/tickets（葉領域）─────────────────────────────
export {
  listCustomerTickets, createTicket, listSystemTickets, getSystemTicketById,
} from './notion/tickets'

// ─── 客情拜訪 → 已抽至 ./notion/visits（葉領域）────────────────────────────────
export type { Visit, VisitListResult, VisitFormOptions } from './notion/visits'
export {
  getVisitFormOptions, listVisits, getVisitById, createVisit, updateVisit, deleteVisit,
} from './notion/visits'

async function queryDatabase(databaseId: string | undefined, pageSize = 6) {
  if (!databaseId) return []
  const response: any = await notionCallWithRetry('queryDatabase', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(databaseId),
      page_size: pageSize,
    })
  )

  return response.results ?? []
}

// Fetch the first page of rows. If all records fit in one page, total is exact.
// If there are more pages (has_more = true), we intentionally do NOT paginate —
// sequential Notion API calls for counting caused Vercel function timeouts on cold
// starts. The caller receives hasMore=true and the UI shows "N+" to be honest.

/**
 * Count unique customers who appear in visit records within the current month.
 * Deduplication uses relation ID first (more reliable), falling back to title name.
 */
async function getActiveCustomersThisMonth(): Promise<number> {
  if (!DB.visits) return 0

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  const uniqueCustomers = new Set<string>()
  let cursor: string | undefined

  do {
    const response: any = await notionCallWithRetry('activeCustomersThisMonth', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          and: [
            { property: '日期', date: { on_or_after: firstOfMonth } },
            { property: '日期', date: { on_or_before: lastOfMonth } },
          ],
        },
      })
    )

    for (const page of response.results ?? []) {
      // Prefer relation ID (stable) for deduplication
      const relIds = getRelationIds(page, '🏥 牙科單位資料')
      if (relIds.length > 0) {
        relIds.forEach((id: string) => uniqueCustomers.add(id))
      } else {
        // Fallback: use title as key
        const name = getTitle(page, '單位名稱').trim()
        if (name) uniqueCustomers.add(`name:${name}`)
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)

  return uniqueCustomers.size
}

async function getCustomersSummary(): Promise<ModuleSummary> {
  const [{ rows, total, hasMore }, activeThisMonth] = await Promise.all([
    querySummary(DB.customers),
    getActiveCustomersThisMonth(),
  ])
  return {
    total,
    hasMore,
    activeThisMonth,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '客戶名稱'),
      meta: [getSelect(page, '縣市'), getSelect(page, '客戶類型')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}


/** Count tickets created in the current calendar month. */
async function getTicketsThisMonth(): Promise<number> {
  if (!DB.tickets) return 0
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  let count = 0
  let cursor: string | undefined
  do {
    const response: any = await notionCallWithRetry('ticketsThisMonth', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.tickets!),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          timestamp: 'created_time',
          created_time: { on_or_after: firstOfMonth },
        },
      })
    )
    count += (response.results ?? []).length
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

async function getTicketsSummary(): Promise<ModuleSummary> {
  const [{ rows, total, hasMore }, activeThisMonth] = await Promise.all([
    querySummary(DB.tickets),
    getTicketsThisMonth(),
  ])
  return {
    total,
    hasMore,
    activeThisMonth,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title:
        getTitle(page, '編號') ||
        getText(page, '案件標題') ||
        getText(page, '客戶單位') ||
        '未命名案件',
      meta: [getSelect(page, '狀態'), getSelect(page, '優先級')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getOpportunitiesSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.opportunities)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '商機名稱'),
      meta: [
        getText(page, '負責業務'),
        getSelect(page, '商機階段'),
        getDate(page, '下次跟進日'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getProductsSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.products)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, 'Name'),
      meta: [getSelect(page, '生產商'), getSelect(page, '分類')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getUsersSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.users, 50)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 20).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '帳號名稱'),
      meta: [
        getText(page, '帳號代碼'),
        getSelect(page, '帳號類型'),
        getSelect(page, '狀態'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const cached = await getRedisValue<DashboardSummary>('dashboard:summary:v3')
  if (cached) return cached

  const safe = async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn()
    } catch (error) {
      console.warn('dashboard summary warning:', error)
      return fallback
    }
  }

  const [customers, tickets, opportunities, products, users] = await Promise.all([
    safe(getCustomersSummary, { total: 0, recent: [] }),
    safe(getTicketsSummary, { total: 0, recent: [] }),
    safe(getOpportunitiesSummary, { total: 0, recent: [] }),
    safe(getProductsSummary, { total: 0, recent: [] }),
    safe(getUsersSummary, { total: 0, recent: [] }),
  ])

  const summary: DashboardSummary = { customers, tickets, opportunities, products, users }

  await setRedisValue('dashboard:summary:v3', summary, 300_000) // 5 min
  return summary
}

export async function getModuleRecords(module: keyof DashboardSummary) {
  const summary = await getDashboardSummary()
  return summary[module]
}

export async function getRoleSummary() {
  const users = await getUsersSummary()

  const counters = users.recent.reduce(
    (acc, item) => {
      if (item.meta.includes('業務')) acc.sales += 1
      if (item.meta.includes('中央管理')) acc.admin += 1
      if (item.meta.includes('行政')) acc.ops += 1
      return acc
    },
    { sales: 0, admin: 0, ops: 0 }
  )

  return counters
}

// ─── 客戶設備 → 已抽至 ./notion/equipment ───────────────────────────────────────
export { searchEquipment, listCustomerEquipment, getEquipmentById, updateEquipment } from './notion/equipment'

// ── 醫事監控：最近一次比對結果（伺服器端共用，跨裝置/不受清快取影響）──────────
const MONITOR_RESULT_KEY = 'medical-monitor:last-result'
export async function getCachedMonitorResult<T = unknown>(): Promise<T | null> {
  return getRedisValue<T>(MONITOR_RESULT_KEY)
}
export async function setCachedMonitorResult(value: unknown): Promise<void> {
  return setRedisValue(MONITOR_RESULT_KEY, value, 30 * 24 * 60 * 60_000) // 30 天
}

// ── 醫事監控：比對紀錄（每月摘要趨勢，供對照；伺服器端持久、刷新不消失）──────────
const MONITOR_HISTORY_KEY = 'medical-monitor:history'
export interface MonitorHistoryEntry {
  month:             string   // 快照月份 YYYY-MM（一個月一筆，重複比對會更新同月）
  computedAt:        string
  totalClinics:      number   // 全台：診所+衛生所
  totalLabs:         number   // 全台：牙技+鑲牙
  totalHospitals:    number   // 全台：醫院
  totalSchools:      number   // 全台：學校（教育部 schools.json）
  custClinics:       number   // 崧達客戶：牙醫診所+衛生所
  custLabs:          number   // 崧達客戶：牙體技術所+鑲牙所
  custHospitals:     number   // 崧達客戶：醫院
  custSchools:       number   // 崧達客戶：學術機構
  customerWithCode:  number
  inBasOpen:         number   // 客戶代碼比中 BAS 開業
  toDevelop:         number   // 待開發（BAS 有、非客戶）
  suspectedClosures: number
  hospitalUnverified:number
  codeChanged:       number
  inconsistentData:  number
}
export async function getMonitorHistory(): Promise<MonitorHistoryEntry[]> {
  return (await getRedisValue<MonitorHistoryEntry[]>(MONITOR_HISTORY_KEY)) ?? []
}
export async function pushMonitorHistory(entry: MonitorHistoryEntry): Promise<void> {
  const list = (await getRedisValue<MonitorHistoryEntry[]>(MONITOR_HISTORY_KEY)) ?? []
  const idx = list.findIndex(r => r.month === entry.month)
  if (idx >= 0) list[idx] = entry; else list.push(entry)
  list.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)) // 新到舊
  await setRedisValue(MONITOR_HISTORY_KEY, list.slice(0, 36), 400 * 24 * 60 * 60_000) // 約 13 個月
}

/** 讀「診所監控紀錄」DB 某月的逐筆異動（本月異動視圖用）*/
export interface MonthlyChange {
  type: string; name: string; code: string; address: string; customer: string; customerUrl: string
}
export async function getMonthlyMonitorChanges(month: string): Promise<MonthlyChange[]> {
  if (!DB.monitor) return []
  const dbId = normalizeDatabaseId(DB.monitor)
  const WANT = new Set(['新開業', '新增停業', '停業', '恢復開業'])
  const out: MonthlyChange[] = []
  let cursor: string | undefined
  try {
    do {
      const res: any = await notionCallWithRetry('getMonthlyMonitorChanges', () =>
        notion.databases.query({
          database_id: dbId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
          filter: { property: '月份', date: { equals: `${month}-01` } },
        })
      )
      for (const p of res.results ?? []) {
        const type = p.properties?.['異動類型']?.select?.name ?? ''
        if (!WANT.has(type)) continue
        out.push({
          type,
          name:        getText(p, '健保名稱'),
          code:        getText(p, '機構代碼'),
          address:     getText(p, '地址'),
          customer:    getText(p, '客戶名稱'),
          customerUrl: p.properties?.['客戶頁面']?.url ?? '',
        })
      }
      cursor = res.has_more ? res.next_cursor : undefined
    } while (cursor)
  } catch { /* 無紀錄回空 */ }
  return out
}

/** 寫入「醫事數量趨勢」Notion DB（永久紀錄，一月一列；以月份 title upsert）*/
export async function upsertMedicalTrend(e: MonitorHistoryEntry): Promise<void> {
  if (!DB.medicalTrend) return
  const dbId = normalizeDatabaseId(DB.medicalTrend)
  const props: any = {
    '月份':           { title: [{ text: { content: e.month } }] },
    '紀錄時間':       { date: { start: e.computedAt } },
    '全台_牙醫診所':  { number: e.totalClinics },
    '全台_牙體技術所':{ number: e.totalLabs },
    '全台_醫院':      { number: e.totalHospitals },
    '全台_學校':      { number: e.totalSchools },
    '客戶_牙醫診所':  { number: e.custClinics },
    '客戶_牙體技術所':{ number: e.custLabs },
    '客戶_醫院':      { number: e.custHospitals },
    '客戶_學校':      { number: e.custSchools },
    '客戶有代碼':     { number: e.customerWithCode },
    '在BAS開業':      { number: e.inBasOpen },
    '待開發':         { number: e.toDevelop },
    '疑似歇業':       { number: e.suspectedClosures },
    '醫院待確認':     { number: e.hospitalUnverified },
    '更換代碼':       { number: e.codeChanged },
    '資料不一致':     { number: e.inconsistentData },
  }
  // 以月份查詢既有列 → 有則更新、無則新增（一月一列）
  const q: any = await notionCallWithRetry('upsertMedicalTrend:find', () =>
    notion.databases.query({ database_id: dbId, filter: { property: '月份', title: { equals: e.month } }, page_size: 1 })
  )
  const existing = q.results?.[0]
  if (existing) {
    await notionCallWithRetry('upsertMedicalTrend:update', () =>
      notion.pages.update({ page_id: existing.id, properties: props })
    )
  } else {
    await notionCallWithRetry('upsertMedicalTrend:create', () =>
      notion.pages.create({ parent: { database_id: dbId }, properties: props })
    )
  }
}


export type ProductItem = {
  id: string
  name: string
  manufacturer: string    // 生產商
  productType: string     // 商品類型 (軟體/設備/材料/耗材)
  category: string        // 分類 (研磨機/鋯塊/…)
  price: number | null    // 價格
  salePrice: number | null // 優惠價
  notes: string           // 備註
  weight: number | null   // 重量 (kg)
  // Technical specs
  bendingStrength: string     // 彎曲強度
  transparency: string        // 材料透度
  sinteringTemp: string       // 燒結溫度
  bendingModulus: string      // 彎曲模數 (Mpa)
  flexuralStrength: string    // 抗彎強度 (MPa)
  tensileStrength: string     // 抗拉強度 (MPa)
  elongation: string          // 拉伸伸長率
  hardness: string            // 硬度
  workingDistance: string     // 工作距離
  fieldWidth: string          // 景寬
  fieldDepth: string          // 景深
}

function getProductNumber(page: any, field: string): number | null {
  const v = page.properties?.[field]?.number
  return v == null ? null : v
}

// Fetches all products (cached 60 s) and returns them; caller can filter client-side.
async function getAllProducts(): Promise<ProductItem[]> {
  if (!DB.products) return []
  const cacheKey = 'products:all'
  const cached = getCachedValue<ProductItem[]>(cacheKey)
  if (cached) return cached

  const response: any = await notionCallWithRetry('getAllProducts', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.products!),
      page_size: 100,
    })
  )

  const items = (response.results ?? []).map((page: any) => {
    // Title field is called 'Name' in this DB
    let name = ''
    for (const val of Object.values(page.properties ?? {}) as any[]) {
      if (val.type === 'title') {
        name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
        break
      }
    }
    return {
      id: page.id,
      name,
      manufacturer: getSelect(page, '生產商'),
      productType: getSelect(page, '商品類型'),
      category: getSelect(page, '分類'),
      price: getProductNumber(page, '價格'),
      salePrice: getProductNumber(page, '優惠價'),
      notes: getText(page, '備註'),
      weight: getProductNumber(page, '重量 (kg)'),
      bendingStrength: getText(page, '彎曲強度'),
      transparency: getText(page, '材料透度'),
      sinteringTemp: getText(page, '燒結溫度'),
      bendingModulus: getText(page, '彎曲模數 (Mpa)'),
      flexuralStrength: getText(page, '抗彎強度 (MPa)'),
      tensileStrength: getText(page, '抗拉強度 (MPa)'),
      elongation: getText(page, '拉伸伸長率'),
      hardness: getText(page, '硬度'),
      workingDistance: getText(page, '工作距離'),
      fieldWidth: getText(page, '景寬'),
      fieldDepth: getText(page, '景深'),
    }
  })

  setCachedValue(cacheKey, items, 600_000) // 10 min
  return items
}

export async function searchProducts(query: string): Promise<ProductItem[]> {
  const all = await getAllProducts()
  const keyword = query.trim().toLowerCase()
  if (!keyword) return all
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.manufacturer.toLowerCase().includes(keyword) ||
      p.category.toLowerCase().includes(keyword) ||
      p.productType.toLowerCase().includes(keyword)
  )
}

export async function getProductCategories(): Promise<{ brands: string[]; types: string[]; categories: string[] }> {
  const all = await getAllProducts()
  const brands     = Array.from(new Set(all.map((p) => p.manufacturer).filter(Boolean))).sort() as string[]
  const types      = Array.from(new Set(all.map((p) => p.productType).filter(Boolean))).sort() as string[]
  const categories = Array.from(new Set(all.map((p) => p.category).filter(Boolean))).sort() as string[]
  return { brands, types, categories }
}

// ── accounts & permissions ────────────────────────────────────

export const MODULE_KEYS = ['crm', 'rma', 'bd', 'products', 'quote', 'orders', 'promotions', 'events', 'course_costs', 'assets', 'admin', 'clinic_monitor', 'trip_planner', 'accounts'] as const
export type ModuleKey = typeof MODULE_KEYS[number]
export type ModulePermission = { view: boolean; edit: boolean }
export type UserPermissions = Record<ModuleKey, ModulePermission>

export const MODULE_LABELS: Record<ModuleKey, string> = {
  crm:        '客戶管理',
  rma:        '技術支援',
  bd:         '業務開發',
  products:   '產品',
  quote:      '報價',
  orders:     '訂貨',
  promotions: '促銷活動',
  events:       '活動管理',
  course_costs: '辦課成本',
  assets:       '素材庫',
  admin:          '行政管理',
  clinic_monitor: '客戶資料監控',
  trip_planner:   '行程規劃',
  accounts:       '帳號權限',
}

const MODULE_NOTION_FIELDS: Record<ModuleKey, { view: string; edit: string }> = {
  crm:        { view: 'CRM檢視',      edit: 'CRM編輯'      },
  rma:        { view: 'RMA檢視',      edit: 'RMA編輯'      },
  bd:         { view: 'BD檢視',       edit: 'BD編輯'       },
  products:   { view: '產品檢視',     edit: '產品編輯'     },
  quote:      { view: '報價檢視',     edit: '報價編輯'     },
  orders:     { view: '訂貨檢視',     edit: '訂貨編輯'     },
  promotions: { view: '促銷活動檢視', edit: '促銷活動編輯' },
  events:       { view: '活動管理檢視', edit: '活動管理編輯' },
  course_costs: { view: '辦課成本檢視', edit: '辦課成本編輯' },
  assets:       { view: '素材庫檢視',   edit: '素材庫編輯'   },
  admin:          { view: '行政管理檢視',     edit: '行政管理編輯'     },
  clinic_monitor: { view: '客戶資料監控檢視', edit: '客戶資料監控編輯' },
  trip_planner:   { view: '行程規劃檢視',     edit: '行程規劃編輯'     },
  accounts:       { view: '帳號檢視',         edit: '帳號編輯'         },
}

export function allPermissions(): UserPermissions {
  const result = {} as UserPermissions
  for (const mod of MODULE_KEYS) result[mod] = { view: true, edit: true }
  return result
}

function getCheckbox(page: any, field: string): boolean {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'checkbox') return false
  return prop.checkbox === true
}

// 帳號管理／後台行政這兩個模組一旦預設開放就等同提權（accounts 可建立/改其他帳號，
// admin 可動到主檔高風險操作），欄位缺失時必須預設「false」，不可沿用其他模組的開放預設。
const DEFAULT_DENY_MODULES = new Set<ModuleKey>(['accounts', 'admin'])

function mapUserPermissions(page: any): UserPermissions {
  const result = {} as UserPermissions
  for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
    // 若 Notion 資料庫尚未建立該欄位，一般模組預設為 true（避免在新增模組初期意外封鎖所有人）；
    // 高風險模組（accounts/admin）預設為 false，欄位缺失時一律視為未授權。
    const denyDefault = DEFAULT_DENY_MODULES.has(mod as ModuleKey)
    const viewProp = getProp(page, fields.view)
    const editProp = getProp(page, fields.edit)
    result[mod as ModuleKey] = {
      view: viewProp ? viewProp.checkbox === true : !denyDefault,
      edit: editProp ? editProp.checkbox === true : !denyDefault,
    }
  }
  return result
}

export type SystemUser = {
  id: string
  name: string
  username: string
  accountType: string
  status: string
  permissions: UserPermissions
}

let _userFieldsEnsured = false
async function ensureUserDbFields() {
  if (_userFieldsEnsured) return
  try {
    const permProps: Record<string, any> = {
      帳號代碼: { rich_text: {} },   // username — needed for login filter
      密碼:   { rich_text: {} },   // password
    }
    for (const fields of Object.values(MODULE_NOTION_FIELDS)) {
      permProps[fields.view] = { checkbox: {} }
      permProps[fields.edit] = { checkbox: {} }
    }
    await notion.databases.update({
      database_id: normalizeDatabaseId(DB.users),
      properties: permProps as any,
    })
  } catch (e) {
    console.warn('ensureUserDbFields warning:', e)
  }
  _userFieldsEnsured = true
}

export async function getSystemUsers(): Promise<SystemUser[]> {
  const cacheKey = 'users:all'
  const cached = getCachedValue<SystemUser[]>(cacheKey)
  if (cached) return cached

  await ensureUserDbFields()

  const response: any = await notionCallWithRetry('getSystemUsers', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      page_size: 50,
    })
  )

  const items: SystemUser[] = (response.results ?? []).map((page: any) => ({
    id: page.id,
    name: getTitle(page, '帳號名稱'),
    username: getText(page, '帳號代碼'),
    accountType: getSelect(page, '帳號類型'),
    status: getSelect(page, '狀態'),
    permissions: mapUserPermissions(page),
  }))

  setCachedValue(cacheKey, items, 600_000) // 10 min
  return items
}

// ── 密碼雜湊（bcrypt，含舊版明文資料的登入時遷移）─────────────────────────────
// bcrypt hash 一律以 $2a$/$2b$/$2y$ 開頭；用這個前綴判斷舊資料是否仍為明文。
const BCRYPT_HASH_RE = /^\$2[aby]\$/
const BCRYPT_ROUNDS = 10

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

async function verifyPassword(stored: string, supplied: string): Promise<boolean> {
  if (BCRYPT_HASH_RE.test(stored)) {
    return bcrypt.compare(supplied, stored)
  }
  // 舊版明文密碼：仍可比對登入，但比對後應立即於呼叫端改寫成雜湊（見 getSystemUserByCredentials）
  return stored === supplied
}

export async function getSystemUserByCredentials(
  username: string,
  password: string
): Promise<(SystemUser & { password: string }) | null> {
  await ensureUserDbFields()
  const response: any = await notionCallWithRetry('getSystemUserByCredentials', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      filter: { property: '帳號代碼', rich_text: { equals: username } },
    })
  )
  for (const page of response.results ?? []) {
    const storedPw = getText(page, '密碼')
    const matches = await verifyPassword(storedPw, password)
    if (matches) {
      const status = getSelect(page, '狀態')
      if (status === '停用') return null   // 已停用帳號，拒絕登入

      // 舊版明文密碼登入成功時，當場改寫成雜湊（migrate-on-login），下次起不再是明文。
      if (!BCRYPT_HASH_RE.test(storedPw)) {
        const newHash = await hashPassword(password)
        await notionCallWithRetry('migratePasswordHash', () =>
          notion.pages.update({ page_id: page.id, properties: { 密碼: { rich_text: richText(newHash) } } as any })
        ).catch((e) => console.error('migratePasswordHash error:', e))
      }

      return {
        id: page.id,
        name: getTitle(page, '帳號名稱'),
        username: getText(page, '帳號代碼'),
        accountType: getSelect(page, '帳號類型'),
        status,
        password: storedPw,
        permissions: mapUserPermissions(page),
      }
    }
  }
  return null
}

export async function createSystemUser(data: {
  name: string
  username: string
  password: string
  accountType: string
  status?: string
  permissions: UserPermissions
}): Promise<SystemUser> {
  await ensureUserDbFields()
  const permProps: Record<string, any> = {}
  for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
    const p = data.permissions[mod as ModuleKey]
    permProps[fields.view] = { checkbox: p.view }
    permProps[fields.edit] = { checkbox: p.edit }
  }
  const hashedPassword = await hashPassword(data.password)
  const response: any = await notionCallWithRetry('createSystemUser', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.users) },
      properties: {
        帳號名稱: { title: richText(data.name) },
        帳號代碼: { rich_text: richText(data.username) },
        密碼: { rich_text: richText(hashedPassword) },
        ...(data.accountType ? { 帳號類型: { select: { name: data.accountType } } } : {}),
        ...(data.status ? { 狀態: { status: { name: data.status } } } : {}),
        ...permProps,
      } as any,
    })
  )
  transientCache.delete('users:all')

  return {
    id: response.id,
    name: data.name,
    username: data.username,
    accountType: data.accountType,
    status: getSelect(response, '狀態') || data.status || '未開始',
    permissions: data.permissions,
  }
}

export async function getSystemUserById(id: string): Promise<SystemUser> {
  await ensureUserDbFields()
  const page: any = await notionCallWithRetry('getSystemUserById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  return {
    id: page.id,
    name: getTitle(page, '帳號名稱'),
    username: getText(page, '帳號代碼'),
    accountType: getSelect(page, '帳號類型'),
    status: getSelect(page, '狀態'),
    permissions: mapUserPermissions(page),
  }
}

export async function updateSystemUser(
  id: string,
  data: {
    name?: string
    password?: string
    accountType?: string
    status?: string
    permissions?: UserPermissions
  }
): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.name !== undefined) properties['帳號名稱'] = { title: richText(data.name) }
  if (data.password !== undefined) properties['密碼'] = { rich_text: richText(await hashPassword(data.password)) }
  if (data.accountType !== undefined) properties['帳號類型'] = { select: { name: data.accountType } }
  if (data.status !== undefined) properties['狀態'] = { status: { name: data.status } }
  if (data.permissions !== undefined) {
    for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
      const p = data.permissions[mod as ModuleKey]
      properties[fields.view] = { checkbox: p.view }
      properties[fields.edit] = { checkbox: p.edit }
    }
  }
  await notionCallWithRetry('updateSystemUser', () =>
    notion.pages.update({ page_id: id, properties } as any)
  )
  transientCache.delete('users:all')
}

export async function deleteSystemUser(id: string): Promise<void> {
  await notionCallWithRetry('deleteSystemUser', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  transientCache.delete('users:all')
}

// ─── Clinic Monitor ───────────────────────────────────────────────────────────

export type ClinicMonitorRecord = {
  id: string
  title: string
  month: string        // YYYY-MM
  type: '新增停業' | '恢復開業' | '新開業' | '停業' | '查無代碼' | '月份摘要'
  institutionCode: string
  nhiName: string
  customerName: string
  customerUrl: string
  address: string
  specialty: string
  termDate: string     // ISO date or empty
}

export type ClinicMonitorSummary = {
  month: string
  totalActive: number
  stopped: number
  restored: number
  notFound: number
  affectedCustomers: number
}

function mapClinicRecord(page: any): ClinicMonitorRecord {
  const props = page.properties
  const getT  = (f: string) => props[f]?.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  const getU  = (f: string) => props[f]?.url ?? ''
  const getDt = (f: string) => props[f]?.date?.start ?? ''
  const getSel= (f: string) => props[f]?.select?.name ?? ''
  const title = props['標題']?.title?.map((t: any) => t.plain_text).join('') ?? ''
  const monthRaw = getDt('月份')   // YYYY-MM-DD
  const month = monthRaw ? monthRaw.slice(0, 7) : ''

  return {
    id:              page.id,
    title,
    month,
    type:            getSel('異動類型') as ClinicMonitorRecord['type'],
    institutionCode: getT('機構代碼'),
    nhiName:         getT('健保名稱'),
    customerName:    getT('客戶名稱'),
    customerUrl:     getU('客戶頁面'),
    address:         getT('地址'),
    specialty:       getT('診療科別'),
    termDate:        getDt('終止日期'),
  }
}

/** 取得診所監控紀錄（最近 N 個月，預設 3 個月） */
export async function getClinicMonitorRecords(months = 3): Promise<ClinicMonitorRecord[]> {
  const dbId = process.env.NOTION_CLINIC_MONITOR_DB
  if (!dbId) return []

  const cacheKey = `clinic-monitor:${months}`
  const cached = await getRedisValue<ClinicMonitorRecord[]>(cacheKey)
  if (cached) return cached

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const records: ClinicMonitorRecord[] = []
  let cursor: string | undefined

  do {
    const body: any = {
      page_size: 100,
      sorts: [{ property: '月份', direction: 'descending' }],
      filter: {
        property: '月份',
        date: { on_or_after: cutoffDate },
      },
    }
    if (cursor) body.start_cursor = cursor

    const res = await notionCallWithRetry('getClinicMonitorRecords', () =>
      notion.databases.query({ database_id: dbId, ...body })
    ) as any

    for (const page of res.results) {
      records.push(mapClinicRecord(page))
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  await setRedisValue(cacheKey, records, 10 * 60_000)  // cache 10 min
  return records
}

// ─── 活動管理 / 報名 → 已抽至 ./notion/events ───────────────────────────────────
export type { EventItem, EventRegistration } from './notion/events'
export {
  listEvents, getEventById, createEvent, updateEvent, deleteEvent,
  listEventRegistrations, listCustomerEvents, updateRegistrationStatus,
} from './notion/events'

// ─── 辦課成本試算 → 已抽至 ./notion/course-costs ────────────────────────────────
export type { CourseCost } from './notion/course-costs'
export { listCourseCosts, createCourseCost, updateCourseCost, deleteCourseCost } from './notion/course-costs'

