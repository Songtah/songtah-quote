/**
 * lib/registration-footprint.ts —— 客戶足跡（組合層：活動報名 × 活動 × 客戶主檔）
 *
 * 行銷活動整合（2026-09-15 使用者定案）：
 *   課程報名 → 外掛表單直接寫 Notion 報名 DB
 *   展會參與 → 現場 QR 簽到頁 /checkin 寫入同一個報名 DB
 *   驅動方式 → 成為「拜訪建議」的訊號，負責業務自動看到，不新增任何手動項目
 *
 * 本模組做兩件事，都不需要人：
 *   1. processRegistrations：補「活動」relation（依表單活動名稱）與「客戶配對」relation
 *   2. getEventFootprints：每家客戶最近一次的活動足跡，供拜訪建議評分
 *
 * 配對寧可漏、不可錯掛（與 LINE 客情自動關聯同標準）：
 *   名稱字根唯一相符 → 配對；多家同名 → 用縣市、再用電話末 8 碼縮小；仍不唯一 → 不配對，寫明原因。
 * 已經有客戶配對的（人工或先前自動）一律不覆寫。
 */
import {
  listRecentRegistrations, updateRegistrationLinks, listAllEvents,
  type EventItem, type EventRegistration,
} from '@/lib/notion/events'
import { getAllSystemCustomers, getSystemCustomerById, type CustomerListItem } from '@/lib/notion/customers'
import { getRedisValue, setRedisValue, deleteRedisValue } from '@/lib/notion/shared'
import { isSameCustomerName, customerNameStem } from '@/lib/customer-name-match'
import { isInactiveCustomer } from '@/lib/customer-status'

/** 足跡有效期：超過就不再當作拜訪訊號 */
export const FOOTPRINT_WINDOW_DAYS = 60
/** 自動配對回溯範圍：表單可能晚幾週才補齊，放寬到 120 天 */
const PROCESS_WINDOW_DAYS = 120

const tw = (s: string) => (s ?? '').replace(/臺/g, '台').trim()
const phoneTail = (s: string) => (s ?? '').replace(/\D/g, '').replace(/^886/, '0').slice(-8)

// ── 1. 活動關聯 ─────────────────────────────────────────────────

function matchEvent(formName: string, events: EventItem[]): EventItem | null {
  const key = formName.replace(/\s/g, '')
  if (!key) return null
  const exact = events.filter((e) => e.name.replace(/\s/g, '') === key)
  if (exact.length === 1) return exact[0]
  const partial = events.filter((e) => {
    const n = e.name.replace(/\s/g, '')
    return n && (n.includes(key) || key.includes(n))
  })
  return partial.length === 1 ? partial[0] : null
}

// ── 2. 客戶配對 ─────────────────────────────────────────────────

async function matchCustomer(
  reg: EventRegistration, customers: CustomerListItem[],
): Promise<{ customerId: string | null; note: string }> {
  const name = reg.institution.trim()
  if (customerNameStem(name).length < 2) return { customerId: null, note: '機構名稱太短，無法比對' }

  let hits = customers.filter((c) => !isInactiveCustomer(c.status) && isSameCustomerName(name, c.name))
  if (hits.length === 0) return { customerId: null, note: '客戶庫查無此機構（可能是新客戶）' }
  if (hits.length === 1) return { customerId: hits[0].id, note: `名稱相符：${hits[0].name}` }

  if (reg.city) {
    const inCity = hits.filter((c) => tw(c.city).startsWith(tw(reg.city).slice(0, 2)))
    if (inCity.length === 1) return { customerId: inCity[0].id, note: `名稱＋縣市相符：${inCity[0].name}` }
    if (inCity.length > 1) hits = inCity
  }

  const tail = phoneTail(reg.phone)
  if (tail.length === 8 && hits.length <= 8) {
    const details = await Promise.all(hits.map((c) => getSystemCustomerById(c.id)))
    const byPhone = details.filter((d) => d && phoneTail(d.phone) === tail)
    if (byPhone.length === 1) return { customerId: byPhone[0]!.id, note: `名稱＋電話相符：${byPhone[0]!.name}` }
  }

  return {
    customerId: null,
    note: `同名機構 ${hits.length} 家無法確定：${hits.slice(0, 4).map((c) => `${c.name}（${c.city}${c.district}）`).join('、')}`,
  }
}

export type ProcessResult = {
  scanned: number
  eventLinked: number
  customerMatched: number
  unmatched: number
  /** dryRun 時列出將寫入的內容（不寫 Notion） */
  planned?: { id: string; institution: string; patch: Record<string, unknown> }[]
}

/**
 * 補齊近 120 天報名的活動關聯與客戶配對。冪等：已有值的欄位不重寫。
 *
 * 客戶配對要掃全客戶庫（冷啟動約 60 秒），每小時都重掃會拖垮 Notion 配額。所以：
 *   一般執行只處理「還沒試過配對」的新報名（配對說明為空）；
 *   retryUnmatched（每天第一輪排程、活動頁「立即重新配對」）才重試先前沒配到的——
 *   例如當時是新機構、之後被匯入客戶庫。
 */
export async function processRegistrations(params: { onlyIds?: string[]; dryRun?: boolean; retryUnmatched?: boolean } = {}): Promise<ProcessResult> {
  const regs = (await listRecentRegistrations(PROCESS_WINDOW_DAYS))
    .filter((r) => r.status !== '取消')
    .filter((r) => !params.onlyIds || params.onlyIds.includes(r.id))
  const result: ProcessResult = { scanned: regs.length, eventLinked: 0, customerMatched: 0, unmatched: 0, ...(params.dryRun ? { planned: [] } : {}) }
  const needsCustomer = (r: EventRegistration) => !r.customerId && (params.retryUnmatched || !r.matchNote)
  const pending = regs.filter((r) => (!r.eventId && r.formEventName) || !r.source || needsCustomer(r))
  if (!pending.length) return result

  const [events, customers] = await Promise.all([
    pending.some((r) => !r.eventId) ? listAllEvents() : Promise.resolve([] as EventItem[]),
    pending.some(needsCustomer) ? getAllSystemCustomers() : Promise.resolve([] as CustomerListItem[]),
  ])

  for (const reg of pending) {
    const patch: Parameters<typeof updateRegistrationLinks>[1] = {}
    if (!reg.source) patch.source = '報名表單'   // 外掛表單寫入時通常不帶來源
    if (!reg.eventId && reg.formEventName) {
      const ev = matchEvent(reg.formEventName, events)
      if (ev) { patch.eventId = ev.id; result.eventLinked++ }
    }
    if (needsCustomer(reg)) {
      const { customerId, note } = await matchCustomer(reg, customers)
      if (customerId) { patch.customerId = customerId; patch.matchNote = note; result.customerMatched++ }
      else {
        result.unmatched++
        if (note !== reg.matchNote) patch.matchNote = note
      }
    }
    if (!Object.keys(patch).length) continue
    if (params.dryRun) result.planned!.push({ id: reg.id, institution: reg.institution, patch })
    else await updateRegistrationLinks(reg.id, patch)
  }

  if (!params.dryRun && (result.customerMatched || result.eventLinked)) await deleteRedisValue(FOOTPRINTS_CACHE_KEY)
  return result
}

// ── 3. 足跡訊號 ─────────────────────────────────────────────────

export type EventFootprint = {
  /** 活動日（無活動日則為報名日），YYYY-MM-DD */
  date: string
  eventName: string
  eventType: string
  status: string          // 已到場／已確認／已報名
  source: string
}

const FOOTPRINTS_CACHE_KEY = 'event-footprints-v1'

/** 客戶 id（去 dash）→ 最近一次足跡。已到場優先於報名。快取 1 小時，配對寫入時清除。 */
export async function getEventFootprints(): Promise<Record<string, EventFootprint>> {
  const cached = await getRedisValue<Record<string, EventFootprint>>(FOOTPRINTS_CACHE_KEY)
  if (cached) return cached

  const regs = (await listRecentRegistrations(FOOTPRINT_WINDOW_DAYS + 90))
    .filter((r) => r.customerId && r.status !== '取消')
  const out: Record<string, EventFootprint> = {}
  if (regs.length) {
    const events = new Map((await listAllEvents()).map((e) => [e.id, e]))
    const rank = (s: string) => (s === '已到場' ? 2 : 1)
    for (const r of regs) {
      const ev = events.get(r.eventId)
      const fp: EventFootprint = {
        // 現場簽到以實際簽到日為準（多日展會第三天來的就是第三天）；報名以活動日為準
        date: r.status === '已到場' && r.registeredAt
          ? new Date(new Date(r.registeredAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
          : (ev?.date || r.registeredAt || '').slice(0, 10),
        eventName: ev?.name || r.formEventName || '活動',
        eventType: ev?.type ?? '',
        status: r.status,
        source: r.source,
      }
      const key = r.customerId.replace(/-/g, '')
      const prev = out[key]
      if (!prev || fp.date > prev.date || (fp.date === prev.date && rank(fp.status) > rank(prev.status))) out[key] = fp
    }
  }
  await setRedisValue(FOOTPRINTS_CACHE_KEY, out, 60 * 60_000)
  return out
}
