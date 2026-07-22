
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

// ─── 客戶主檔 → 已抽至 ./notion/customers（葉領域）──────────────────────────────
export type { SystemCustomerDetail, CustomerSearchResult, CustomerListItem, CustomerWithCode } from './notion/customers'
export {
  listAllSystemCustomers, getSystemCustomerById, searchSystemCustomers,
  getAllSystemCustomers, listSystemCustomersPaginated, getCustomersWithCodes,
  createSystemCustomer, updateCustomerStatus, getCustomerFilterOptions,
} from './notion/customers'

// ─── 工單 / RMA → 已抽至 ./notion/tickets（葉領域）─────────────────────────────
export {
  listCustomerTickets, createTicket, updateTicket, listSystemTickets, getSystemTicketById,
} from './notion/tickets'

// ─── 客情拜訪 → 已抽至 ./notion/visits（葉領域）────────────────────────────────
export type { Visit, VisitListResult, VisitFormOptions } from './notion/visits'
export {
  getVisitFormOptions, listVisits, getVisitById, createVisit, updateVisit, deleteVisit,
} from './notion/visits'

// ─── 客戶設備 → 已抽至 ./notion/equipment ───────────────────────────────────────
export { searchEquipment, listCustomerEquipment, getEquipmentById, updateEquipment } from './notion/equipment'

// ─── 活動管理 / 報名 → 已抽至 ./notion/events ───────────────────────────────────
export type { EventItem, EventRegistration } from './notion/events'
export {
  listEvents, getEventById, createEvent, updateEvent, deleteEvent,
  listEventRegistrations, listCustomerEvents, updateRegistrationStatus, getRegistrationById,
} from './notion/events'

// ─── 辦課成本試算 → 已抽至 ./notion/course-costs ────────────────────────────────
export type { CourseCost } from './notion/course-costs'
export { listCourseCosts, createCourseCost, updateCourseCost, deleteCourseCost } from './notion/course-costs'

// ─── 權限模型 → 已抽至 ./notion/permissions-model（leaf）──────────────────────────
export type { ModuleKey, ModulePermission, UserPermissions } from './notion/permissions-model'
export { MODULE_KEYS, MODULE_LABELS, allPermissions, mapUserPermissions } from './notion/permissions-model'

// ─── 系統帳號 / 登入 → 已抽至 ./notion/accounts（葉領域）─────────────────────────
export type { SystemUser } from './notion/accounts'
export {
  getSystemUsers, getSystemUserByCredentials, createSystemUser,
  getSystemUserById, updateSystemUser, deleteSystemUser,
} from './notion/accounts'

// ─── 業務轄區設定 → ./notion/territories（葉領域）──────────────────────────────
export type { Territory, TerritoryStatus } from './notion/territories'
export {
  TERRITORY_STATUSES, listTerritories, getTerritory, createTerritory, updateTerritory,
} from './notion/territories'
