import type { CreateTicketPayload, UpdateTicketPayload } from '@/types'

export const TICKET_TYPES = ['技術支援', '維修', 'RMA', '換貨', '客訴', '安裝', '教育訓練'] as const
export const TICKET_STATUSES = ['尚未處理', '👌 已受理', '🔍 診斷問題中', '🔧 維修中', '⚙️ 測試中', '🔍 後續追蹤', '✅ 結案'] as const

// 服務期限提醒：目前系統無正式 SLA 欄位，先以優先級推估合理回應天數
// (供列表逾期標示與首頁待辦聚合共用，避免兩處各自定義互相漂移)。
export const TICKET_SLA_DAYS: Record<string, number> = { P1: 1, P2: 3, P3: 7, P4: 14 }

/**
 * 工單逾期判定（2026-11-10 使用者定義；首頁、業績總覽、工單列表共用，禁止各處另寫一套）。
 * 舊定義靠「預計維修日」與「優先級」，但 339 張工單這兩欄填答率都是 0，逾期數永遠是 0。
 * 新定義只靠系統一定有的建立日期，不要求任何人補欄位：
 *   - 未結案且建立超過期限天數 → 逾期（overdue）。期限＝有優先級用 TICKET_SLA_DAYS，沒有就 14 天；
 *     有填預計維修日且已過也算逾期。
 *   - 未結案且建立超過 90 天 → 久未處理（stale），不計入逾期數——舊單多半早已處理只是沒結案，
 *     混進逾期會把真正該追的案件淹沒（改定義當下：逾期 12 張、久未處理 144 張）。
 */
export const TICKET_DEFAULT_DUE_DAYS = 14
export const TICKET_STALE_DAYS = 90
const TICKET_CLOSED = new Set(['✅ 結案', '已結案', '結案', '完成'])
export type TicketDueState = { state: 'overdue' | 'due' | 'stale'; days: number; limit: number } | null

export function ticketDueState(
  t: { status?: string; priority?: string; createdDate?: string; scheduledDate?: string },
  now: Date = new Date(),
): TicketDueState {
  if (TICKET_CLOSED.has(t.status ?? '')) return null
  const created = t.createdDate ? new Date(t.createdDate) : null
  if (!created || Number.isNaN(created.getTime())) return null
  const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000)
  const limit = TICKET_SLA_DAYS[t.priority ?? ''] ?? TICKET_DEFAULT_DUE_DAYS
  if (days > TICKET_STALE_DAYS) return { state: 'stale', days, limit }
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  if (t.scheduledDate && t.scheduledDate.slice(0, 10) < today) return { state: 'overdue', days, limit }
  if (days > limit) return { state: 'overdue', days, limit }
  if (days === limit) return { state: 'due', days, limit }
  return null
}

/**
 * 工單狀態轉換防呆：只允許往後推進（可跳步，如簡單案件可直接受理即結案）
 * 或從「✅ 結案」重開回「🔍 後續追蹤」；禁止其他任何倒退（例如結案後誤點回維修中）。
 */
export function isValidTicketStatusTransition(from: string, to: string): boolean {
  if (from === to) return true
  const fromIdx = TICKET_STATUSES.indexOf(from as typeof TICKET_STATUSES[number])
  const toIdx = TICKET_STATUSES.indexOf(to as typeof TICKET_STATUSES[number])
  if (fromIdx === -1 || toIdx === -1) return false   // 未知狀態一律拒絕，不放行
  if (toIdx > fromIdx) return true                    // 往後推進（含跳步）
  if (from === '✅ 結案' && to === '🔍 後續追蹤') return true   // 結案後重開
  return false
}
export const TICKET_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const
export const TICKET_SUPPORT_OWNERS = ['小黃', 'Paul', 'Aaron', 'Ted', 'Luca', 'Brain', '致廷'] as const
export const TICKET_SALES_OWNERS = ['公司直營', 'Duncan', 'Gus', 'Hank', 'James', 'Eason', 'Amy', '小郭', 'Paul', 'Chloe'] as const
export const TICKET_MANUFACTURERS = ['ASIGA', 'Zirkonzahn', 'Zirkonzhan', '金泰', 'KO-MAX', 'BSM 貝施美', 'BSM', '普登', 'AR Loupe', 'ACTILINK', 'Graphy', 'HANAU'] as const

const NOTION_PAGE_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const UPDATE_FIELDS = ['status', 'priority', 'supportOwner', 'salesOwner', 'scheduledDate', 'cause', 'solution', 'note', 'equipmentId'] as const

function isAllowed(value: string, allowed: readonly string[]) {
  return allowed.includes(value)
}

export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function validateCreateTicketPayload(body: CreateTicketPayload): string | null {
  const optionChecks: Array<[string, string | undefined, readonly string[]]> = [
    ['案件類型', body.ticketType, TICKET_TYPES],
    ['狀態', body.status || '尚未處理', TICKET_STATUSES],
    ['優先級', body.priority || 'P2', TICKET_PRIORITIES],
    ['技術支援對口', body.supportOwner, TICKET_SUPPORT_OWNERS],
    ['業務窗口', body.salesOwner, TICKET_SALES_OWNERS],
    ['生產商', body.manufacturer, TICKET_MANUFACTURERS],
  ]
  for (const [label, value, allowed] of optionChecks) {
    if (value && !isAllowed(value, allowed)) return `${label}不是有效選項`
  }

  const relationChecks: Array<[string, string | undefined]> = [
    ['客戶', body.customerId],
    ['設備', body.equipmentId],
    ['產品', body.productId],
  ]
  for (const [label, value] of relationChecks) {
    if (value && !NOTION_PAGE_ID.test(value)) return `${label} relation ID 格式錯誤`
  }

  if (body.scheduledDate && !isValidDateOnly(body.scheduledDate)) {
    return '預計維修日期格式錯誤'
  }
  return null
}

export function validateUpdateTicketPayload(body: unknown):
  | { ok: true; data: UpdateTicketPayload; changedFields: string[] }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '更新內容格式錯誤' }
  }

  const source = body as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.length === 0) return { ok: false, error: '沒有可更新的欄位' }

  const unknown = keys.find((key) => !UPDATE_FIELDS.includes(key as typeof UPDATE_FIELDS[number]))
  if (unknown) return { ok: false, error: `不允許更新欄位：${unknown}` }

  for (const key of keys) {
    if (typeof source[key] !== 'string') return { ok: false, error: `${key} 必須是文字` }
  }

  const data = source as UpdateTicketPayload
  if (data.status !== undefined && !isAllowed(data.status, TICKET_STATUSES)) {
    return { ok: false, error: '狀態不是有效選項' }
  }
  if (data.priority && !isAllowed(data.priority, TICKET_PRIORITIES)) {
    return { ok: false, error: '優先級不是有效選項' }
  }
  if (data.supportOwner && !isAllowed(data.supportOwner, TICKET_SUPPORT_OWNERS)) {
    return { ok: false, error: '技術支援對口不是有效選項' }
  }
  if (data.salesOwner && !isAllowed(data.salesOwner, TICKET_SALES_OWNERS)) {
    return { ok: false, error: '業務窗口不是有效選項' }
  }
  if (data.scheduledDate && !isValidDateOnly(data.scheduledDate)) {
    return { ok: false, error: '預計維修日期格式錯誤' }
  }
  if (data.equipmentId && !NOTION_PAGE_ID.test(data.equipmentId)) {
    return { ok: false, error: '設備 relation ID 格式錯誤' }
  }
  for (const key of ['cause', 'solution', 'note'] as const) {
    if (data[key] !== undefined && data[key]!.length > 2000) {
      return { ok: false, error: `${key} 超過 2000 字` }
    }
  }

  return { ok: true, data, changedFields: keys }
}
