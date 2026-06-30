import bcrypt from 'bcryptjs'

// ─── 跨切面 relation 解析 → ./notion/relations ─────────────────────────────────
export { resolveCustomerInfo, resolveProductNames, resolveCustomerNames } from './notion/relations'

// ─── 儀表板彙總（組合層）→ ./notion/dashboard ──────────────────────────────────
export type { ModuleSummary, DashboardSummary } from './notion/dashboard'
export { getProductsSummary, getDashboardSummary, getModuleRecords, getRoleSummary } from './notion/dashboard'

// ─── 產品搜尋 → ./notion/products-search（葉領域）──────────────────────────────
export type { ProductItem } from './notion/products-search'
export { searchProducts, getProductCategories } from './notion/products-search'

// ─── 醫事監控 → ./notion/medical-monitor（葉領域）─────────────────────────────
export type { MonitorHistoryEntry, MonthlyChange, ClinicMonitorRecord, ClinicMonitorSummary } from './notion/medical-monitor'
export {
  getCachedMonitorResult, setCachedMonitorResult, getMonitorHistory, pushMonitorHistory,
  getMonthlyMonitorChanges, upsertMedicalTrend, getClinicMonitorRecords,
} from './notion/medical-monitor'

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

// ─── 客戶設備 → 已抽至 ./notion/equipment ───────────────────────────────────────
export { searchEquipment, listCustomerEquipment, getEquipmentById, updateEquipment } from './notion/equipment'

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

// ─── 活動管理 / 報名 → 已抽至 ./notion/events ───────────────────────────────────
export type { EventItem, EventRegistration } from './notion/events'
export {
  listEvents, getEventById, createEvent, updateEvent, deleteEvent,
  listEventRegistrations, listCustomerEvents, updateRegistrationStatus,
} from './notion/events'

// ─── 辦課成本試算 → 已抽至 ./notion/course-costs ────────────────────────────────
export type { CourseCost } from './notion/course-costs'
export { listCourseCosts, createCourseCost, updateCourseCost, deleteCourseCost } from './notion/course-costs'

