import type { CreateTicketPayload, UpdateTicketPayload } from '@/types'

export const TICKET_TYPES = ['技術支援', '維修', 'RMA', '換貨', '客訴', '安裝', '教育訓練'] as const
export const TICKET_STATUSES = ['尚未處理', '👌 已受理', '🔍 診斷問題中', '🔧 維修中', '⚙️ 測試中', '🔍 後續追蹤', '✅ 結案'] as const
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
