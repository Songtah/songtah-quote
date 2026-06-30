/**
 * lib/notion/permissions-model.ts — 權限模型（leaf）
 *
 * 模組清單、權限型別、Notion 欄位對照與權限解析。獨立成 leaf module，讓
 * lib/permissions.ts、lib/api-auth.ts、types/next-auth.d.ts、lib/notion/accounts.ts
 * 都從這裡取型別與解析邏輯，避免回頭依賴肥大的 system-notion barrel。
 */
import { getProp } from './shared'

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

export const MODULE_NOTION_FIELDS: Record<ModuleKey, { view: string; edit: string }> = {
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

// 帳號管理／後台行政這兩個模組一旦預設開放就等同提權（accounts 可建立/改其他帳號，
// admin 可動到主檔高風險操作），欄位缺失時必須預設「false」，不可沿用其他模組的開放預設。
const DEFAULT_DENY_MODULES = new Set<ModuleKey>(['accounts', 'admin'])

export function mapUserPermissions(page: any): UserPermissions {
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
