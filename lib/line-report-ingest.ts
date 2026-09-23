/**
 * lib/line-report-ingest.ts —— LINE 日報 → 客情紀錄（webhook、失敗重試、補匯共用）
 *
 * ── 2026-09-15 事故與修正 ───────────────────────────────────────────────────
 * 9/9～9/14 各業務每天只進 1～2 筆客情、Eason 9 月幾乎全缺，兩個原因：
 *   1. 以發送時間判斷日報性質：隔天早上補的「行程回報」被丟、晚上先發的「工作安排」被當拜訪
 *      → 改由內容判斷（lib/line-daily-report classifyDailyReport）
 *   2. 每筆客情建完就做自動認領，而認領全掃客戶庫（冷啟動 60 秒），webhook 60 秒時限內
 *      只來得及建第 1 筆就被砍 → 認領改讀單一客戶；且本模組改為「先全部建檔、再做認領與階段推進」，
 *      時限提高到 300 秒；每則日報存入 Redis，沒跑完的由每小時排程重試。
 *
 * 冪等：同業務、同日期、同客戶（名稱字根）已有紀錄就略過——同一則日報重送、重試、補匯都不會重複。
 */
import { parseDailyReport, devStageForReaction } from '@/lib/line-daily-report'
import { createVisit, listVisits, getVisitFormOptions } from '@/lib/notion/visits'
import { searchSystemCustomers, advanceCustomerDevStage } from '@/lib/notion/customers'
import { applyAutoClaimForVisit } from '@/lib/notion/visit-claim'
import { customerNameStem, isSameCustomerName } from '@/lib/customer-name-match'
import { loadMatchContext, matchVisitCustomer } from '@/lib/notion/match-context'
import { loadAliases } from '@/lib/notion/visit-alias'
import { detectCompetitors } from '@/lib/competitor-detector'
import { getRedis } from '@/lib/notion/shared'

export type IngestResult = {
  date: string
  total: number
  created: number
  skippedExisting: number
  failures: { customer: string; message: string }[]
  planned?: { customer: string; date: string; content: string }[]
}

const stemKey = (name: string) => (customerNameStem(name) || name).toLowerCase().replace(/\s/g, '')

export async function ingestDailyReport(input: {
  text: string
  salesperson: string
  /** 日報沒寫「日期：」時用的業務日 */
  fallbackDate: string
  dryRun?: boolean
  /**
   * 同一批次已建立（或 dry-run 已計畫）的鍵：業務|日期|字根。
   * Notion 查詢有數秒延遲，連續處理多則日報時剛建的紀錄可能還查不到，靠這份記憶避免重複建立。
   */
  batchKeys?: Set<string>
  /**
   * 補匯歷史紀錄時設 true：不做自動認領。
   * 補幾個月前的拜訪不該讓客戶在今天被直接指派出去——回放既有資料一律走「待認領建議」讓人確認
   * （與 visit-claim 的 retroactive 規則一致）。
   */
  skipClaim?: boolean
}): Promise<IngestResult> {
  const report = parseDailyReport(input.text, input.fallbackDate)
  const result: IngestResult = { date: report?.date ?? input.fallbackDate, total: 0, created: 0, skippedExisting: 0, failures: [] }
  if (!report || report.visits.length === 0) return result
  result.total = report.visits.length

  // 既有紀錄（同業務同日）→ 去重
  const existing = await listVisits({ salesperson: input.salesperson, dateFrom: report.date, dateTo: report.date, fetchAll: true })
  // 既有紀錄在列表上顯示的是「客戶主檔正式名稱」（林口長庚 → 長庚醫療財團法人林口長庚紀念醫院），
  // 只比名稱字根會認不出是同一家而重複建立，所以同時比：名稱相符、或配對到的客戶 id 相同。
  // 有關聯客戶的用 id 比；沒關聯的（手打名稱）才用名稱字根「完全相同」比——
  // 不用包含比對：同一天「桃園長庚」「林口長庚」字根互相包含，會把另一家的真實拜訪當重複略過。
  const unlinkedNames = new Set(existing.items.filter((v) => !v.customerId).map((v) => stemKey(v.customerName)))
  // 第三道：拜訪內容完全相同＝同一筆（日報是原文照抄）。名稱是簡稱、主檔是全名、又比對不到唯一客戶時
  // （實例：「新竹台大」vs「國立臺灣大學醫學院附設醫院新竹臺大分院生醫醫院」），只有內容能認出是同一筆。
  // 內容比前 40 個有效字：同一段日報被重貼時常多一個空白或標點，整串比會漏
  const contentKey = (s: string) => (s ?? '').replace(/[\s。·•\-－]/g, '').slice(0, 40)
  const existingContents = new Set(existing.items.map((v) => contentKey(v.content)).filter((c) => c.length >= 10))
  // 第四道：同業務同日、名稱指同一家（「聯合醫院陽明院區」vs 手打「聯合醫院」）也算重複——
  // 既有紀錄的名稱多半已是主檔全名，簡稱比不到字根完全相同
  const existingNames = existing.items.map((v) => v.customerName).filter(Boolean)
  const existingIds = new Set(existing.items.map((v) => v.customerId.replace(/-/g, '')).filter(Boolean))
  const batchPrefix = `${input.salesperson}|${report.date}|`
  const isDup = (key: string) => input.batchKeys?.has(batchPrefix + key)
  const remember = (key: string) => input.batchKeys?.add(batchPrefix + key)

  const byName = report.visits.filter((v) => {
    const k = stemKey(v.customerName)
    if (isDup(k) || unlinkedNames.has(k) || existingContents.has(contentKey(v.content))
      || existingNames.some((n) => isSameCustomerName(v.customerName, n))) {
      result.skippedExisting++
      return false
    }
    remember(k)   // 同一則日報內重複列同一家也只建一筆
    return true
  })

  const formOptions = input.dryRun ? null : await getVisitFormOptions()
  if (input.dryRun) result.planned = []

  // 消歧義脈絡（轄區／活動縣市／歷史往來）：走快取，拿不到就退化成「唯一才配」的舊行為。
  // 絕不在這裡重算——建檔路徑全掃客戶庫曾導致 webhook 60 秒逾時。
  const matchCtx = await loadMatchContext()
  const aliases = await loadAliases().catch(() => ({ manual: {}, learned: {} }))

  // ── 第一階段：全部先建檔（最重要，確保紀錄進系統）──
  const createdVisits: { customerId?: string; unambiguous: boolean; reaction: string; name: string }[] = []
  for (const visit of byName) {
    try {
      // 比對一律走 matchVisitCustomer（慣用稱呼記憶 → 名稱字根＋業務脈絡），與夜間補關聯同一套規則
      const res = await matchVisitCustomer({
        name: visit.customerName, salesperson: input.salesperson, ctx: matchCtx, aliases,
        search: (q) => searchSystemCustomers(q),
      })
      const matched = res.id ? { id: res.id } : null
      if (!matched && res.candidates.length > 1) {
        console.log(`[LINE ingest] 待確認配對 ${input.salesperson} ${report.date} ${visit.customerName}：${res.reason}`)
      }

      // 配對到的客戶當天已有紀錄（名稱寫法不同但同一家）→ 略過
      const idKey = matched ? `id:${matched.id.replace(/-/g, '')}` : ''
      if (matched && (existingIds.has(matched.id.replace(/-/g, '')) || isDup(idKey))) {
        result.skippedExisting++
        continue
      }
      if (idKey) remember(idKey)

      if (input.dryRun) {
        result.planned!.push({ customer: visit.customerName, date: report.date, content: visit.content })
        continue
      }
      const reaction = formOptions!.customerReactions.includes(visit.customerReaction) ? visit.customerReaction : ''

      await createVisit({
        customerName: visit.customerName,
        customerId: matched?.id,
        date: report.date,
        salesperson: input.salesperson,
        content: visit.content,
        interactionType: '拜訪',
        interactionPurpose: '',
        customerReaction: reaction,
        followUpAction: '',
        needsFollowUp: visit.needsFollowUp,
        nextFollowUpDate: visit.nextFollowUpDate,
        status: '',
        address: '', city: '', district: '',
        tags: [],
        competitorEquipment: detectCompetitors(visit.content, formOptions!.competitorOptions),
        interestedProductIds: [],
      })
      result.created++
      createdVisits.push({ customerId: matched?.id, unambiguous: Boolean(matched), reaction, name: visit.customerName })
    } catch (err: any) {
      const message = err?.body?.message ?? err?.message ?? String(err)
      result.failures.push({ customer: visit.customerName, message })
      console.error(`[LINE ingest] createVisit error (${input.salesperson} ${report.date} ${visit.customerName}): ${message}`)
    }
  }

  if (input.dryRun) return result

  // ── 第二階段：自動認領與開發階段推進（失敗不影響已建的紀錄）──
  for (const v of createdVisits) {
    if (!v.customerId) continue
    const claim = input.skipClaim
      ? { claimed: false, reason: 'backfill-skip' }
      : await applyAutoClaimForVisit({ salesperson: input.salesperson, customerId: v.customerId, unambiguous: v.unambiguous })
        .catch(() => ({ claimed: false, reason: 'error' }))
    await advanceCustomerDevStage(v.customerId, devStageForReaction(v.reaction), { actorName: input.salesperson, canManageAll: false })
      .catch(() => false)
    if (claim.claimed) console.log(`[LINE ingest] 自動認領 ${v.name} → ${input.salesperson}（${claim.reason}）`)
  }

  console.log(`[LINE ingest] ${input.salesperson} ${report.date}：共 ${result.total}、新建 ${result.created}、已存在 ${result.skippedExisting}、失敗 ${result.failures.length}`)
  return result
}

// ── 日報佇列：webhook 收到先存，沒跑完（逾時／失敗）由排程重試 ─────────────────

export type QueuedReport = {
  id: string            // LINE message id
  text: string
  salesperson: string
  fallbackDate: string
  receivedAt: string
  attempts: number
  status: 'pending' | 'done' | 'failed'
  lastResult?: Omit<IngestResult, 'planned'>
  lastError?: string
}

const recordKey = (id: string) => `line-report:${id}`
const PENDING_SET = 'line-report:pending'
const RECORD_TTL_SEC = 14 * 86400
export const MAX_ATTEMPTS = 4

export async function enqueueReport(r: Omit<QueuedReport, 'attempts' | 'status' | 'receivedAt'>): Promise<QueuedReport> {
  const record: QueuedReport = { ...r, receivedAt: new Date().toISOString(), attempts: 0, status: 'pending' }
  const redis = getRedis()
  if (redis) {
    // 同一則訊息 LINE 可能重送：已存在就不覆蓋
    await redis.set(recordKey(r.id), record, { ex: RECORD_TTL_SEC, nx: true })
    await redis.sadd(PENDING_SET, r.id)
  }
  return record
}

/** 執行一則佇列中的日報，更新狀態。沒有 Redis（本機）時直接執行。 */
export async function runQueuedReport(record: QueuedReport): Promise<QueuedReport> {
  const redis = getRedis()
  const next: QueuedReport = { ...record, attempts: record.attempts + 1 }
  // 先記下「嘗試中」，即使這次被砍，下次重試也知道已試過幾次
  if (redis) await redis.set(recordKey(record.id), next, { ex: RECORD_TTL_SEC })
  try {
    const res = await ingestDailyReport({ text: record.text, salesperson: record.salesperson, fallbackDate: record.fallbackDate })
    const { planned: _p, ...lastResult } = res
    next.lastResult = lastResult
    next.status = res.failures.length === 0 ? 'done' : next.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    if (res.failures.length) next.lastError = res.failures[0].message
  } catch (err: any) {
    next.lastError = err?.message ?? String(err)
    next.status = next.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    console.error(`[LINE ingest] 🚨 ${record.salesperson} 日報處理失敗（第 ${next.attempts} 次）：${next.lastError}`)
  }
  if (redis) {
    await redis.set(recordKey(record.id), next, { ex: RECORD_TTL_SEC })
    if (next.status !== 'pending') await redis.srem(PENDING_SET, record.id)
  }
  return next
}

/** 排程重試：收到超過 minAgeMs 仍未完成的日報 */
export async function retryPendingReports(minAgeMs = 5 * 60_000): Promise<{ checked: number; retried: QueuedReport[] }> {
  const redis = getRedis()
  if (!redis) return { checked: 0, retried: [] }
  const ids = ((await redis.smembers(PENDING_SET)) ?? []) as string[]
  const retried: QueuedReport[] = []
  for (const id of ids) {
    const record = await redis.get<QueuedReport>(recordKey(id))
    if (!record) { await redis.srem(PENDING_SET, id); continue }
    if (record.status !== 'pending') { await redis.srem(PENDING_SET, id); continue }
    if (Date.now() - Date.parse(record.receivedAt) < minAgeMs) continue
    retried.push(await runQueuedReport(record))
  }
  return { checked: ids.length, retried }
}
