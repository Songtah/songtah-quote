/**
 * lib/visit-repair-tickets.ts —— 客情提到維修 → 自動開技術支援工單（組合層：客情 × 工單 × 設備 × 客戶）
 *
 * 2026-10-21 使用者定案（方案 A）：維修是「案件」，歸技術支援工單管理（派工由主管指派、技術人員看工單系統），
 * 不在客情上另記一套（CLAUDE.md 最高原則第 5 條：同一件事只能有一套表達）。業務只回報日報，工單由系統開。
 *
 * 規則：
 *   - 判讀由 lib/visit-reaction-ai.ts 一併完成（RepairFinding：待處理／處理中／已完成＋原文依據）；
 *     別家原廠售後、客戶自己修、只是關心機器狀況，判讀時就排除
 *   - 只處理已關聯客戶的客情；未關聯的先記在 Redis，等配對後由夜間排程補開
 *   - 不重複開：同客戶、同品牌（認不出品牌視為同一件）90 天內有未結案工單 → 把這次內容補進該工單備註
 *   - 已完成：有對應未結案工單 → 補備註「業務回報已處理完成」（結案仍由技術人員確認）；沒有 → 開一張已結案工單留維修履歷
 *   - 設備：客戶名下同品牌設備只有一台才關聯，不猜
 *   - 同一筆客情只處理一次（Redis 記錄），重試、回補都不會重複開
 */
import { createTicket, updateTicket, listCustomerTickets, getSystemTicketById } from '@/lib/notion/tickets'
import { listCustomerEquipment } from '@/lib/notion/equipment'
import { getRedis } from '@/lib/notion/shared'
import { pushLineMessage } from '@/lib/line-push'
import { findLineGroupByName } from '@/lib/line-groups'
import type { RepairFinding } from '@/lib/visit-reaction-ai'

const DONE_KEY = 'repair-ticket:visits'      // set：已處理過的客情 id
const PENDING_KEY = 'repair-ticket:pending'  // hash：客情 id → 待配對客戶的維修資訊
const CLOSED_STATUS = '✅ 結案'
const OPEN_STATUS = '尚未處理'

export type VisitRepairInput = {
  visitId: string
  visitDate: string
  salesperson: string
  customerId?: string
  customerName: string
  repair: RepairFinding
}

export type RepairTicketOutcome =
  | { action: 'created'; ticketId: string; number: string; closed: boolean }
  | { action: 'appended'; ticketId: string; number: string }
  | { action: 'pending' | 'skipped'; reason: string }

// 紀錄裡的品牌寫法 → 工單「生產商」選項（沿用工單庫現有選項名稱，含既有拼法 Zirkonzhan）
const BRANDS: { re: RegExp; option: string }[] = [
  { re: /zirkonzahn|zirkonzhan|\bzz\b|zz/i, option: 'Zirkonzhan' },
  { re: /asiga/i, option: 'ASIGA' },
  { re: /ko-?max|komax|科邁/i, option: 'KO-MAX' },
  { re: /金泰/, option: '金泰' },
  { re: /bsm|貝施美/i, option: 'BSM' },
  { re: /hanau/i, option: 'HANAU' },
  { re: /普登/, option: '普登' },
  { re: /cadster|cad ster/i, option: 'CADster' },
  { re: /gencore/i, option: 'Gencore' },
  { re: /ar\s?loupe/i, option: 'AR Loupe' },
]
export function detectBrand(text: string): string {
  return BRANDS.find((b) => b.re.test(text ?? ''))?.option ?? ''
}
const sameBrand = (a: string, b: string) => {
  const n = (x: string) => (x ?? '').toLowerCase().replace(/zirkonzahn/, 'zirkonzhan').replace(/[^a-z0-9一-龥]/g, '')
  return n(a) === n(b)
}

const visitUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, '')}`
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const daysAgo = (d: string) => (Date.parse(today()) - Date.parse(d)) / 86400_000

/**
 * 主管通知：發到「崧達售後服務報修詢問群組」（官方帳號已加入；群組 ID 由 webhook 記錄，見 lib/line-groups.ts）。
 * TECH_MANAGER_LINE_ID 有設定時以它為準；群組還沒被記錄到（群組裡還沒人發過言）就略過。
 */
export async function notifyManager(text: string): Promise<boolean> {
  const to = process.env.TECH_MANAGER_LINE_ID || await findLineGroupByName(/售後服務|報修/).catch(() => '')
  if (!to) return false
  try {
    await pushLineMessage(to, text)
    return true
  } catch (e: any) {
    console.warn('[repair-ticket] LINE 通知失敗:', e?.message ?? e)
    return false
  }
}

/** 由一筆客情開工單或補進既有工單 */
export async function createRepairTicketFromVisit(input: VisitRepairInput, options: { dryRun?: boolean } = {}): Promise<RepairTicketOutcome> {
  const r = getRedis()
  const vid = input.visitId.replace(/-/g, '')
  if (r && (await r.sismember(DONE_KEY, vid))) return { action: 'skipped', reason: '這筆客情已處理過' }
  if (!input.customerId) {
    if (!options.dryRun && r) await r.hset(PENDING_KEY, { [vid]: input })
    return { action: 'pending', reason: '客情尚未關聯客戶，配對後補開' }
  }

  const { repair } = input
  const brand = detectBrand(`${repair.equipment} ${repair.evidence}`)
  const source = `由客情自動建立：${input.visitDate} ${input.salesperson} 回報「${repair.evidence}」｜客情 ${visitUrl(input.visitId)}`

  // 不重複開：同客戶、同品牌、90 天內未結案。
  // 剛建立的工單 Notion 查詢要幾秒後才查得到，連續處理同一家的兩筆客情會重複開——先看 Redis 記的近期工單。
  const recentKey = `repair-ticket:recent:${input.customerId.replace(/-/g, '')}|${brand || '-'}`
  const tickets = await listCustomerTickets(input.customerId)
  const recentId = r ? await r.get<string>(recentKey) : null
  if (recentId && !tickets.some((t) => t.id === recentId)) {
    const t = await getSystemTicketById(recentId).catch(() => null)
    if (t) tickets.unshift(t as any)
  }
  const open = tickets.find((t) => t.status !== CLOSED_STATUS && !/結案/.test(t.status)
    && (!t.createdDate || daysAgo(t.createdDate) <= 90)
    && (!brand || !t.manufacturer || sameBrand(t.manufacturer, brand)))

  if (open) {
    if (options.dryRun) return { action: 'appended', ticketId: open.id, number: open.number }
    const line = repair.status === '已完成' ? `${source}（業務回報已處理完成，請確認是否結案）` : source
    await updateTicket(open.id, { note: [open.note, line].filter(Boolean).join('\n').slice(0, 1900) })
    if (r) await r.sadd(DONE_KEY, vid)
    return { action: 'appended', ticketId: open.id, number: open.number }
  }

  // 設備：客戶名下同品牌只有一台才關聯
  let equipmentId: string | undefined
  if (brand) {
    const eq = (await listCustomerEquipment(input.customerId).catch(() => [])).filter((e) => sameBrand(e.manufacturer, brand))
    if (eq.length === 1) equipmentId = eq[0].id
  }

  const closed = repair.status === '已完成'
  if (options.dryRun) return { action: 'created', ticketId: '', number: '', closed }
  const ticket = await createTicket({
    customerName: input.customerName,
    customerId: input.customerId,
    equipmentId,
    title: [repair.equipment, repair.issue].filter(Boolean).join('｜') || '客情回報維修',
    ticketType: '',
    priority: '',
    status: closed ? CLOSED_STATUS : OPEN_STATUS,
    contactName: '',
    supportOwner: '',                      // 由主管指派
    salesOwner: input.salesperson,
    description: repair.evidence,
    note: source,
    manufacturer: brand || undefined,
  })
  if (r) {
    await r.sadd(DONE_KEY, vid)
    await r.hdel(PENDING_KEY, vid)
    if (!closed) await r.set(recentKey, ticket.id, { ex: 7 * 86400 })
  }
  if (!closed) {
    await notifyManager(`🔧 新維修工單 ${ticket.number}（待指派）\n客戶：${input.customerName}\n設備／問題：${[repair.equipment, repair.issue].filter(Boolean).join('｜') || '未註明'}\n業務：${input.salesperson}（${input.visitDate} 回報）\n原文：${repair.evidence}`)
  }
  return { action: 'created', ticketId: ticket.id, number: ticket.number, closed }
}

/** 夜間排程：之前未關聯客戶的維修客情，配對完成後補開工單 */
export async function processPendingRepairTickets(getVisitCustomer: (visitId: string) => Promise<{ customerId: string; customerName: string } | null>) {
  const r = getRedis()
  if (!r) return { checked: 0, created: 0 }
  const all = ((await r.hgetall<Record<string, VisitRepairInput>>(PENDING_KEY)) ?? {}) as Record<string, VisitRepairInput>
  let created = 0
  for (const [vid, input] of Object.entries(all)) {
    // 30 天還沒配對就放棄，避免永遠掛著
    if (daysAgo(input.visitDate) > 30) { await r.hdel(PENDING_KEY, vid); continue }
    const c = await getVisitCustomer(input.visitId).catch(() => null)
    if (!c) continue
    const out = await createRepairTicketFromVisit({ ...input, customerId: c.customerId, customerName: c.customerName })
    if (out.action === 'created' || out.action === 'appended') created++
  }
  return { checked: Object.keys(all).length, created }
}
