/**
 * lib/visit-closures.ts —— 客情回報歇業 → 自動更新客戶「機構狀態」（組合層：客情 × 客戶主檔 × 拜訪訊號）
 *
 * 業務在日報寫「已確認歇業」「去現場已停業」，原本要等人到醫事監控手動改，常常沒人改；
 * 衛福部名冊也要等下個月快照、且歇業登記常延遲。這裡每晚掃最近的客情，直接寫進主檔。
 *
 * 寫入條件（全部成立才寫）：
 *   1. 客情已關聯客戶，文字經 detectClosure 判定為明確歇業／停業（規則與回測見 visit-closure-detect.ts）
 *   2. 這筆客情之後，該客戶沒有更新的拜訪——之後還有人去拜訪，代表仍在營業，不寫
 *   3. 客戶目前不是 停業／已歇業／撤銷
 *   4. 同一筆客情沒有處理過（含被人工復原過的：復原後不再觸發）
 * 每次寫入都留在 Redis hash（醫事監控頁「客情回報歇業」區塊列出、可一鍵復原）並記操作稽核。
 * 這是 CLAUDE.md 醫事監控鐵則 2「狀態回寫須逐筆人工操作」的明確例外：依據是業務親眼確認，且可復原。
 */
import { scanVisitPages } from '@/lib/notion/visits'
import { getSystemCustomerById, updateCustomerStatus } from '@/lib/notion/customers'
import { getVisitSignals } from '@/lib/notion/visit-suggestions'
import { getRedis, getTitle, getText, getDate, getSelect, deleteRedisValue } from '@/lib/notion/shared'
import { logAuditEvent } from '@/lib/audit'
import { detectClosure, type ClosureStatus } from '@/lib/visit-closure-detect'
import { visitClosureApplied } from '@/lib/notification-events'

const LOG_KEY = 'medical-monitor:visit-closures'   // hash：customerId（去連字號）→ VisitClosureEntry
const CLOSED = new Set(['停業', '已歇業', '撤銷'])
const SYSTEM_ACTOR = { name: '系統（客情歇業偵測）', role: 'system' }

export type VisitClosureEntry = {
  customerId: string
  customerName: string
  visitId: string
  visitDate: string
  reporter: string           // 回報的業務
  from: string               // 原本的機構狀態（空白＝''）
  to: ClosureStatus
  keyword: string
  snippet: string
  at: string                 // 寫入時間 ISO
  undoneAt?: string
  undoneBy?: string
}

export type VisitClosureRun = {
  scanned: number
  detected: number
  updated: VisitClosureEntry[]
  skipped: { customerName: string; reason: string }[]
}

const daysAgoTW = (n: number) => new Date(Date.now() + 8 * 3600_000 - n * 86400_000).toISOString().slice(0, 10)
const norm = (id: string) => (id ?? '').replace(/-/g, '')

async function readLog(): Promise<Record<string, VisitClosureEntry>> {
  const r = getRedis()
  if (!r) return {}
  return ((await r.hgetall<Record<string, VisitClosureEntry>>(LOG_KEY)) ?? {}) as Record<string, VisitClosureEntry>
}

async function writeLog(entry: VisitClosureEntry) {
  const r = getRedis()
  if (!r) return
  await r.hset(LOG_KEY, { [norm(entry.customerId)]: entry })
}

/** 掃最近 days 天的客情，偵測歇業並寫入主檔。dryRun 只回報不寫。 */
export async function runVisitClosureDetection(options: { days?: number; dryRun?: boolean } = {}): Promise<VisitClosureRun> {
  const days = options.days ?? 14
  const dryRun = options.dryRun === true
  const since = daysAgoTW(days)

  // 每家客戶只取最新一筆歇業回報
  const hits = new Map<string, { visitId: string; date: string; reporter: string; name: string; hit: NonNullable<ReturnType<typeof detectClosure>> }>()
  let scanned = 0
  for await (const page of scanVisitPages('visit-closures', {
    and: [
      { property: '日期', date: { on_or_after: since } },
      { property: '🏥 牙科單位資料', relation: { is_not_empty: true } },
    ],
  })) {
    scanned++
    const cid = norm(page.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id ?? '')
    const hit = detectClosure(`${getTitle(page, '單位名稱')} ${getText(page, '拜訪內容')}`)
    if (!cid || !hit) continue
    const date = getDate(page, '日期')
    const prev = hits.get(cid)
    if (!prev || date > prev.date) {
      hits.set(cid, { visitId: page.id, date, reporter: getSelect(page, '業務人員') || getText(page, '業務人員'), name: getTitle(page, '單位名稱'), hit })
    }
  }

  const out: VisitClosureRun = { scanned, detected: hits.size, updated: [], skipped: [] }
  if (!hits.size) return out

  const [{ signals }, log] = await Promise.all([getVisitSignals(), readLog()])
  for (const [cid, h] of Array.from(hits)) {
    const done = log[cid]
    if (done && done.visitId === h.visitId) continue   // 處理過（或已被人工復原），不重複觸發
    const lastVisit = signals[cid]?.lastVisit ?? ''
    if (lastVisit > h.date) { out.skipped.push({ customerName: h.name, reason: `${h.date} 回報歇業，但 ${lastVisit} 仍有拜訪` }); continue }
    const customer = await getSystemCustomerById(cid)
    if (!customer) { out.skipped.push({ customerName: h.name, reason: '找不到客戶主檔' }); continue }
    if (CLOSED.has(customer.status)) continue          // 已經是歇業類，不必再寫

    const entry: VisitClosureEntry = {
      customerId: customer.id, customerName: customer.name, visitId: h.visitId, visitDate: h.date,
      reporter: h.reporter, from: customer.status ?? '', to: h.hit.status,
      keyword: h.hit.keyword, snippet: h.hit.snippet, at: new Date().toISOString(),
    }
    if (dryRun) { out.updated.push(entry); continue }
    await updateCustomerStatus(customer.id, entry.to)
    await writeLog(entry)
    visitClosureApplied(entry)
    await logAuditEvent({
      module: 'clinic_monitor', action: 'update', entityType: 'customer-status',
      entityId: customer.id, entityTitle: customer.name,
      summary: `客情回報歇業：${customer.name} 機構狀態 ${entry.from || '空白'} → ${entry.to}（${h.reporter} ${h.date}）`,
      actor: SYSTEM_ACTOR, before: { status: entry.from }, after: { status: entry.to, snippet: entry.snippet },
    }).catch(() => {})
    out.updated.push(entry)
  }
  if (out.updated.length && !dryRun) deleteRedisValue('event-customers-v2')
  return out
}

/** 最近的自動更新紀錄（新到舊），供醫事監控頁顯示 */
export async function listVisitClosures(limit = 50): Promise<VisitClosureEntry[]> {
  const log = await readLog()
  return Object.values(log).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/** 復原：機構狀態改回原值，並標記此筆已復原（同一筆客情不再觸發） */
export async function undoVisitClosure(customerId: string, by: { name: string; id?: string; role?: string }): Promise<VisitClosureEntry> {
  const log = await readLog()
  const entry = log[norm(customerId)]
  if (!entry) throw new Error('找不到這筆自動更新紀錄')
  if (entry.undoneAt) throw new Error('這筆已經復原過')
  const customer = await getSystemCustomerById(entry.customerId)
  if (!customer) throw new Error('找不到客戶主檔')
  if (customer.status !== entry.to) throw new Error(`機構狀態已被改成「${customer.status || '空白'}」，不覆蓋`)
  await updateCustomerStatus(entry.customerId, entry.from)
  const next: VisitClosureEntry = { ...entry, undoneAt: new Date().toISOString(), undoneBy: by.name }
  await writeLog(next)
  await logAuditEvent({
    module: 'clinic_monitor', action: 'update', entityType: 'customer-status',
    entityId: entry.customerId, entityTitle: entry.customerName,
    summary: `復原客情歇業偵測：${entry.customerName} 機構狀態 ${entry.to} → ${entry.from || '空白'}`,
    actor: by, before: { status: entry.to }, after: { status: entry.from },
  }).catch(() => {})
  deleteRedisValue('event-customers-v2')
  return next
}

