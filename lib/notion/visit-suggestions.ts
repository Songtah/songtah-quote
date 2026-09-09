/**
 * lib/notion/visit-suggestions.ts — 拜訪建議（組合層）
 *
 * 跨 客戶／拜訪／轄區／醫事快照 的彙總，依資料層架構原則放組合層。
 *
 * ── 2026-09-09 改版：為什麼整組重寫 ──────────────────────────────────────
 * 舊版分 A 商品興趣／B 例行拜訪／C 陌生開發三組，實跑五個業務×行政區的結果：
 *   B 例行拜訪 **五個全部 0，連「另有」也是 0** —— 這組是死的。
 *   C 陌生開發變成唯一有量的（3–8 筆，但「另有」133–297 筆），
 *   而它的排序訊號只有 1 或 1.5，等於叫業務去掃街。
 * 原因是舊版的判斷依據在這個資料庫裡幾乎不存在：
 *   近一年訂單 涵蓋 **2 家**客戶 · 進行中名單 **0 個** · 客戶等級 全庫 10,000 筆 **皆空**
 *   開發來源=BAS新開業 只有 **1 筆**
 * 唯一夠密的訊號是拜訪紀錄本身（1,857 家有資料）。
 *
 * 新版改用四個訊號評分（2026-09-09 使用者定案），每筆都帶「為什麼推這家」：
 *   1. 逾期追蹤最優先   2. 太久沒拜訪   3. 客戶反應強度   4. 新開業機構
 * 客戶等級與訂單一律不用——前者要業務手填（違反最高原則且實測填答率 0），
 * 後者密度不足以支撐任何排序。
 *
 * 兩種模式：
 *   today — 不必選區。範圍＝我名下客戶 ＋ 我轄區內未認領者。開頁即有名單。
 *   area  — 指定縣市／行政區，用於出差前規劃路線。
 */
import { getRedisValue, setRedisValue } from './shared'
import { listCustomersByArea, getAllSystemCustomers, NON_CLAIMABLE_OWNERS } from './customers'
import { scanCustomerVisitSignals, type CustomerVisitSignal } from './visits'
import { listTerritories } from './territories'
import { isInactiveCustomer } from '@/lib/customer-status'

// ── 快取層 ─────────────────────────────────────────────────────

const SIGNALS_CACHE_KEY = 'visit-suggestion-signals-v2'   // v2＝改版後的新結構
const SIGNALS_TTL_MS = 24 * 60 * 60 * 1000

export async function refreshSuggestionMaps(): Promise<{ builtAt: string; signals: Record<string, CustomerVisitSignal> }> {
  const maps = { builtAt: new Date().toISOString(), signals: await scanCustomerVisitSignals() }
  await setRedisValue(SIGNALS_CACHE_KEY, maps, SIGNALS_TTL_MS)
  return maps
}

async function getSignals() {
  const cached = await getRedisValue<{ builtAt: string; signals: Record<string, CustomerVisitSignal> }>(SIGNALS_CACHE_KEY)
  return cached ?? refreshSuggestionMaps()   // 冷啟動當場算，之後由每晚 cron 保鮮
}

// ── 訊號權重 ───────────────────────────────────────────────────

/** 客戶反應的熱度。取自客情紀錄的「客戶反應」select，由日報解析自動填入。 */
const REACTION_HEAT: Record<string, number> = {
  '確認下單': 100, '要求報價': 90, '同意試用': 85, '積極詢問': 70,
  '有興趣待確認': 55, '安排再次拜訪': 50, '價格有疑慮': 45,
  '持觀望態度': 20, '使用競品': 20, '反應冷淡': 5, '近期無需求': 0,
}

/** 熱度隨時間衰減：半年前的「要求報價」已經不算熱 */
function decay(days: number): number {
  if (days <= 14) return 1
  if (days <= 30) return 0.8
  if (days <= 60) return 0.55
  if (days <= 120) return 0.3
  if (days <= 180) return 0.15
  return 0.05
}

/** 名下客戶超過幾個月沒拜訪就該排進去 */
export const STALE_VISIT_MONTHS = 3

const daysBetween = (iso: string) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3) : Infinity
const monthsSince = (iso: string) => Math.floor(daysBetween(iso) / 30)
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

// ── 型別 ───────────────────────────────────────────────────────

export type SuggestionKind = 'overdue' | 'hot' | 'stale' | 'newOpening'

export type VisitSuggestion = {
  id: string
  name: string
  type: string
  city: string
  district: string
  address: string
  phone: string
  salesperson: string
  /** 主要理由（決定排序的那個訊號） */
  kind: SuggestionKind
  /** 完整說明，逐條列出所有命中的訊號 */
  reasons: string[]
  score: number
  lastVisit: string | null
  isMine: boolean
}

export const KIND_LABEL: Record<SuggestionKind, string> = {
  overdue: '追蹤逾期',
  hot: '客戶正熱',
  stale: '太久沒跑',
  newOpening: '新開業',
}

export type VisitSuggestionResult = {
  mode: 'today' | 'area'
  items: VisitSuggestion[]
  total: number
  byKind: Record<SuggestionKind, number>
  scope: string          // 這次涵蓋的範圍說明，讓使用者知道名單是怎麼來的
  builtAt: string
}

// ── 評分 ───────────────────────────────────────────────────────

type Candidate = {
  id: string; name: string; type: string; city: string; district: string
  address: string; phone: string; salesperson: string; status: string; devSource?: string
}

function scoreCustomer(c: Candidate, sig: CustomerVisitSignal | undefined, me: string) {
  const reasons: string[] = []
  let score = 0
  let kind: SuggestionKind = 'stale'
  const isMine = c.salesperson === me
  const lastVisit = sig?.lastVisit || ''

  // ① 逾期追蹤 —— 最優先。有到期日且已過期者依逾期天數加權。
  const fu = sig?.openFollowUp
  if (fu) {
    if (fu.nextDate && fu.nextDate < today()) {
      const over = daysBetween(fu.nextDate)
      score += 300 + Math.min(over, 90)
      kind = 'overdue'
      reasons.push(`追蹤已逾期 ${over} 天（原訂 ${fu.nextDate}）${fu.action ? `：${fu.action}` : ''}`)
    } else if (fu.nextDate) {
      const dueIn = -daysBetween(fu.nextDate)
      if (dueIn <= 7) {
        score += 200
        kind = 'overdue'
        reasons.push(`${fu.nextDate} 到期追蹤${fu.action ? `：${fu.action}` : ''}`)
      }
    } else {
      // 舊資料沒有到期日（新版解析器上線前的紀錄），仍要露出但排在逾期之後
      score += 90
      kind = 'overdue'
      reasons.push(`${fu.date} 拜訪後追蹤未結案，沒有設定到期日`)
    }
  }

  // ② 客戶反應強度 —— 上次回報寫了什麼，隨時間衰減
  if (sig?.lastReaction) {
    const heat = (REACTION_HEAT[sig.lastReaction] ?? 0) * decay(daysBetween(sig.lastReactionDate))
    if (heat >= 20) {
      score += heat
      if (heat >= 60 && kind !== 'overdue') kind = 'hot'
      reasons.push(`${sig.lastReactionDate} 回報「${sig.lastReaction}」`)
    }
  }

  // ③ 太久沒拜訪 —— 只看自己名下的客戶，別人的不推
  if (isMine) {
    const months = lastVisit ? monthsSince(lastVisit) : null
    if (months === null) {
      score += 60
      if (kind === 'stale') reasons.push('名下客戶，還沒有任何拜訪紀錄')
    } else if (months >= STALE_VISIT_MONTHS) {
      score += 40 + Math.min(months, 24) * 3
      if (kind === 'stale') reasons.push(`名下客戶，已 ${months} 個月沒拜訪`)
    }
  }

  // ④ 新開業 —— 時效性最高，但只在還沒跑過時才推
  if (c.devSource === 'BAS新開業' && !lastVisit) {
    score += 120
    if (kind === 'stale') kind = 'newOpening'
    reasons.push('BAS 新開業機構，尚未接觸')
  }

  return { score, kind, reasons, isMine, lastVisit }
}

// ── 主流程 ─────────────────────────────────────────────────────

export async function buildVisitSuggestions(params: {
  salesperson: string
  mode?: 'today' | 'area'
  city?: string
  district?: string
  limit?: number
  /** 「既有客戶維護」模式的業務：只給名下客戶，不給未認領池 */
  existingOnly?: boolean
}): Promise<VisitSuggestionResult> {
  const me = params.salesperson
  const mode = params.mode ?? 'today'
  const limit = params.limit ?? 20

  const [{ builtAt, signals }, territories] = await Promise.all([getSignals(), listTerritories().catch(() => [])])

  // 我的有效轄區（today 模式的地理範圍）
  const myAreas = new Set(
    territories
      .filter((t) => t.salesperson === me && t.status !== '結束' && t.status !== '暫停' && t.city && t.district)
      .map((t) => `${t.city}|${t.district}`)
  )

  let pool: Candidate[]
  let scope: string
  if (mode === 'area') {
    if (!params.city || !params.district) throw new Error('區域模式需要指定縣市與行政區')
    pool = (await listCustomersByArea({ city: params.city, district: params.district })) as Candidate[]
    scope = `${params.city}${params.district}`
  } else {
    // today：名下客戶 ＋ 我轄區內尚無人負責者。不必選區。
    const all = await getAllSystemCustomers()
    pool = all.filter((c) => {
      if (c.salesperson === me) return true
      if (params.existingOnly) return false
      return !c.salesperson && myAreas.has(`${c.city}|${c.district}`)
    }) as Candidate[]
    scope = myAreas.size > 0
      ? `名下客戶 ＋ ${myAreas.size} 個轄區內的未認領客戶`
      : '名下客戶（你尚未設定轄區，所以沒有納入未認領客戶）'
  }

  const items: VisitSuggestion[] = []
  for (const c of pool) {
    if (isInactiveCustomer(c.status)) continue
    if (NON_CLAIMABLE_OWNERS.has(c.salesperson)) continue          // 公司／盤商不推
    if (c.salesperson && c.salesperson !== me) continue            // 同事的客戶一律不推
    if (params.existingOnly && c.salesperson !== me) continue

    const sig = signals[c.id.replace(/-/g, '')]
    const { score, kind, reasons, isMine, lastVisit } = scoreCustomer(c, sig, me)
    if (score <= 0 || reasons.length === 0) continue

    items.push({
      id: c.id, name: c.name, type: c.type, city: c.city, district: c.district,
      address: c.address, phone: c.phone, salesperson: c.salesperson,
      kind, reasons, score: Math.round(score), lastVisit: lastVisit || null, isMine,
    })
  }

  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-TW'))

  const byKind: Record<SuggestionKind, number> = { overdue: 0, hot: 0, stale: 0, newOpening: 0 }
  for (const i of items) byKind[i.kind]++

  return { mode, items: items.slice(0, limit), total: items.length, byKind, scope, builtAt }
}

// ── 採納追蹤（可追溯：這批建議之後有沒有真的被拜訪）──────────────────────────
//
// 不動 Notion 拜訪紀錄 schema（databases.update 對這個 DB 會清掉既有選項，
// 見 visits.ts 的 ensureVisitDbFields 教訓）。改用 Redis 存「複製拜訪單」事件 log，
// 事後拿實際拜訪日回頭核對：複製後該客戶有沒有新的拜訪紀錄。
//
// 改版後分組由 A/B/C 換成四種 kind，舊 log 的 A/B/C 會被歸到 'legacy' 一併計入總數，
// 不丟棄歷史資料。

export type SuggestionCopyLogEntry = {
  at: string
  salesperson: string
  scope: string                                 // today 模式記範圍說明，area 模式記縣市行政區
  customerIds: string[]
  kinds: Record<string, string>                 // customerId → kind
}

const COPY_LOG_KEY = 'visit-suggestions:copy-log-v1'
const COPY_LOG_MAX = 300

export async function logSuggestionCopy(entry: Omit<SuggestionCopyLogEntry, 'at'>): Promise<void> {
  if (!entry.customerIds.length) return
  const list = (await getRedisValue<SuggestionCopyLogEntry[]>(COPY_LOG_KEY)) ?? []
  list.unshift({ ...entry, at: new Date().toISOString() })
  await setRedisValue(COPY_LOG_KEY, list.slice(0, COPY_LOG_MAX), 400 * 24 * 60 * 60_000)
}

export type AdoptionStats = {
  totalCopies: number
  totalSuggested: number
  totalVisited: number
  rate: number
  byKind: Record<string, { suggested: number; visited: number }>
}

/** 近 N 天的採納率：複製建議後，該客戶是否在複製日之後被拜訪過。 */
export async function getSuggestionAdoptionStats(
  params: { salesperson?: string; sinceDays?: number } = {}
): Promise<AdoptionStats> {
  const sinceDays = params.sinceDays ?? 30
  const sinceDate = new Date(Date.now() - sinceDays * 86400e3).toISOString().slice(0, 10)
  const [log, { signals }] = await Promise.all([
    getRedisValue<SuggestionCopyLogEntry[]>(COPY_LOG_KEY),
    getSignals(),
  ])
  const entries = (log ?? []).filter((e) =>
    e.at.slice(0, 10) >= sinceDate && (!params.salesperson || e.salesperson === params.salesperson))

  let totalSuggested = 0, totalVisited = 0
  const byKind: AdoptionStats['byKind'] = {}
  for (const e of entries) {
    const copyDate = e.at.slice(0, 10)
    for (const cid of e.customerIds) {
      const kind = e.kinds?.[cid] ?? 'legacy'
      byKind[kind] ??= { suggested: 0, visited: 0 }
      totalSuggested++
      byKind[kind].suggested++
      const lastVisit = signals[cid.replace(/-/g, '')]?.lastVisit
      if (lastVisit && lastVisit >= copyDate) {
        totalVisited++
        byKind[kind].visited++
      }
    }
  }
  return {
    totalCopies: entries.length,
    totalSuggested,
    totalVisited,
    rate: totalSuggested ? totalVisited / totalSuggested : 0,
    byKind,
  }
}
