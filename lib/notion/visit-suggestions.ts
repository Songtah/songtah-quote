/**
 * lib/notion/visit-suggestions.ts — 拜訪建議(組合層)
 *
 * 跨 客戶/拜訪/設備/訂單/追蹤名單 五個領域的彙總,依資料層架構原則只能放組合層。
 * 三張重映射(最後拜訪日/設備數/近12月訂單)走 Redis 24h 快取,由每晚 cron 重算保鮮;
 * 名單成員與未結案追蹤量小,即時查。
 *
 * 三組建議(2026-07-13 使用者定案):
 *   A 商品興趣追蹤:報價中/試用中、進行中名單成員(未聯絡/已聯絡/有興趣)、未結案追蹤(帶興趣商品)
 *   B 例行拜訪:自己的活躍客戶(近12月有訂單或有設備在案)且 >3 個月未拜訪
 *   C 陌生開發:線索(devStage)與該區未分派空白池
 * 鐵則:不推「其他業務的客戶」;排除 已歇業/停業/撤銷 與 公司/盤商。
 * 配比為軟性建議(A 全給、B 補到 bCap、C 填滿到 target),不做強制 KPI。
 */
import { getRedisValue, setRedisValue } from './shared'
import { listCustomersByArea, type AreaCustomer } from './customers'
import { scanVisitRecency, listOpenFollowUps } from './visits'
import { scanEquipmentCustomerCounts } from './equipment'
import { listCampaigns, listMembers } from './campaigns'
import { scanOrderActivity } from '@/lib/orders-notion'

// ── 快取層 ─────────────────────────────────────────────────────

export type SuggestionMaps = {
  builtAt: string
  visitRecency: Record<string, string>                       // customerId → 最後拜訪日
  equipmentCounts: Record<string, number>                    // customerId → 設備數
  orderActivity: Record<string, { lastOrder: string; count: number }>  // 近12月
}

const MAPS_CACHE_KEY = 'visit-suggestion-maps-v1'
const MAPS_TTL_MS = 24 * 60 * 60 * 1000

export async function refreshSuggestionMaps(): Promise<SuggestionMaps> {
  const since = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10)
  const [visitRecency, equipmentCounts, orderActivity] = await Promise.all([
    scanVisitRecency(),
    scanEquipmentCustomerCounts(),
    scanOrderActivity(since),
  ])
  const maps: SuggestionMaps = {
    builtAt: new Date().toISOString(),
    visitRecency,
    equipmentCounts,
    orderActivity,
  }
  await setRedisValue(MAPS_CACHE_KEY, maps, MAPS_TTL_MS)
  return maps
}

async function getSuggestionMaps(): Promise<SuggestionMaps> {
  const cached = await getRedisValue<SuggestionMaps>(MAPS_CACHE_KEY)
  if (cached) return cached
  return refreshSuggestionMaps()  // 冷啟動:當場算並回填(約 30–60s,之後由 cron 保鮮)
}

// ── 建議組裝 ────────────────────────────────────────────────────

export type VisitSuggestion = {
  id: string
  name: string
  type: string
  status: string
  address: string
  phone: string
  salesperson: string
  devStage: string
  group: 'A' | 'B' | 'C'
  reason: string
  lastVisit: string | null
}

export type VisitSuggestionResult = {
  groups: { A: VisitSuggestion[]; B: VisitSuggestion[]; C: VisitSuggestion[] }
  more: { B: number; C: number }   // 被軟性配比截掉、還可看的家數
  mapsBuiltAt: string
}

const EXCLUDED_STATUS = new Set(['停業', '已歇業', '撤銷'])
const EXCLUDED_OWNER = new Set(['公司', '盤商'])
const ACTIVE_MEMBER_STATUS = new Set(['未聯絡', '已聯絡', '有興趣'])

function monthsSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (30 * 86400e3))
}

export async function buildVisitSuggestions(params: {
  city: string
  district: string
  salesperson: string
  target?: number   // 一日拜訪量(軟性),預設 8
  bCap?: number     // B 類上限,預設 4
  existingOnly?: boolean // 只維護既有客戶的業務不取得空白池或陌生開發名單
}): Promise<VisitSuggestionResult> {
  const target = params.target ?? 8
  const bCap = params.bCap ?? 4
  const me = params.salesperson

  const [customers, maps, followUps, campaigns] = await Promise.all([
    listCustomersByArea({ city: params.city, district: params.district }),
    getSuggestionMaps(),
    listOpenFollowUps(),
    listCampaigns(),
  ])

  // 進行中名單的活躍成員 → customerId → [{名單, 狀態}]
  const openCampaigns = campaigns.filter((c) => c.status === '進行中')
  const memberLists = await Promise.all(openCampaigns.map((c) => listMembers(c.id)))
  const campaignByCustomer: Record<string, { campaign: string; status: string }[]> = {}
  openCampaigns.forEach((c, i) => {
    for (const m of memberLists[i]) {
      if (!ACTIVE_MEMBER_STATUS.has(m.status)) continue
      const key = (m.customerId || '').replace(/-/g, '')
      if (!key) continue
      ;(campaignByCustomer[key] ??= []).push({ campaign: c.name, status: m.status })
    }
  })

  // 未結案追蹤 → customerId → 最優先一筆(listOpenFollowUps 已按下次追蹤日排序)
  const followByCustomer: Record<
    string,
    { date: string; nextDate: string; products: string[]; action: string }
  > = {}
  for (const v of followUps) {
    const key = (v.customerId || '').replace(/-/g, '')
    if (!key || followByCustomer[key]) continue
    followByCustomer[key] = {
      date: v.date,
      nextDate: v.nextFollowUpDate,
      products: v.interestedProducts.map((p) => p.name).filter(Boolean),
      action: v.followUpAction,
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10)

  const A: (VisitSuggestion & { _sort: number })[] = []
  const B: (VisitSuggestion & { _sort: number })[] = []
  const C: (VisitSuggestion & { _sort: number })[] = []

  for (const c of customers) {
    if (EXCLUDED_STATUS.has(c.status)) continue
    if (EXCLUDED_OWNER.has(c.salesperson)) continue
    if (params.existingOnly && c.salesperson !== me) continue
    const isOthers = !!c.salesperson && c.salesperson !== me  // 同事的客戶,一律不推
    const key = c.id.replace(/-/g, '')
    const lastVisit = maps.visitRecency[key] ?? null
    const base = {
      id: c.id, name: c.name, type: c.type, status: c.status,
      address: c.address, phone: c.phone,
      salesperson: c.salesperson, devStage: c.devStage, lastVisit,
    }

    // ── A 商品興趣追蹤(自己的或空白池)──
    if (!isOthers) {
      const reasons: string[] = []
      let hot = 0
      if (c.devStage === '報價中') { reasons.push('報價中,趁熱跟進'); hot = 4 }
      else if (c.devStage === '試用中') { reasons.push('試用中,回收使用心得'); hot = 3.5 }
      const fu = followByCustomer[key]
      if (fu) {
        const prod = fu.products.length ? `,對「${fu.products.join('、')}」有興趣` : ''
        const act = fu.action ? `,後續:${fu.action}` : ''
        const overdue = fu.nextDate && fu.nextDate < today ? `(追蹤已逾期 ${fu.nextDate})` : ''
        reasons.push(`${fu.date} 拜訪後追蹤未結案${prod}${act}${overdue}`)
        hot = Math.max(hot, fu.nextDate && fu.nextDate < today ? 3 : 2)
      }
      const cams = campaignByCustomer[key]
      if (cams?.length) {
        for (const cm of cams) reasons.push(`「${cm.campaign}」名單成員(${cm.status})`)
        hot = Math.max(hot, cams.some((x) => x.status === '有興趣') ? 3 : 1.5)
      }
      if (reasons.length) {
        A.push({ ...base, group: 'A', reason: reasons.join(';'), _sort: hot })
        continue
      }
    }

    // ── B 例行拜訪(只看自己的活躍客戶)──
    if (c.salesperson === me) {
      const act = maps.orderActivity[key]
      const eq = maps.equipmentCounts[key] ?? 0
      if ((act || eq > 0) && (!lastVisit || lastVisit < threeMonthsAgo)) {
        const parts: string[] = []
        if (act) parts.push(`近一年 ${act.count} 張訂單(最近 ${act.lastOrder})`)
        if (eq) parts.push(`${eq} 台設備在案`)
        parts.push(lastVisit ? `已 ${monthsSince(lastVisit)} 個月未拜訪` : '無拜訪紀錄')
        const staleness = lastVisit ? monthsSince(lastVisit) : 24
        B.push({
          ...base, group: 'B', reason: parts.join(','),
          _sort: staleness + (act ? act.count : 0) * 0.1 + (eq ? 0.5 : 0),
        })
        continue
      }
    }

    // ── C 陌生開發(線索 或 空白未分派)──
    if (!isOthers && (c.devStage === '線索' || (!c.salesperson && !c.devStage))) {
      const reason = c.devStage === '線索'
        ? lastVisit ? `開發線索,上次接觸 ${lastVisit}` : '開發線索,尚未接觸'
        : '此區未分派客戶,拜訪後可至開發漏斗認領'
      C.push({ ...base, group: 'C', reason, _sort: (c.devStage === '線索' ? 2 : 1) + (lastVisit ? 0 : 0.5) })
    }
  }

  A.sort((a, b) => b._sort - a._sort)
  B.sort((a, b) => b._sort - a._sort)
  C.sort((a, b) => b._sort - a._sort)

  // 軟性配比:A 全給、B 補到 bCap、C 填滿到 target(不強制,超出的以 more 回報)
  const bTake = Math.min(B.length, Math.max(0, Math.min(bCap, target - A.length)))
  const cTake = Math.min(C.length, Math.max(0, target - A.length - bTake))

  const strip = (x: VisitSuggestion & { _sort: number }): VisitSuggestion => {
    const { _sort, ...rest } = x
    return rest
  }

  return {
    groups: {
      A: A.map(strip),
      B: B.slice(0, bTake).map(strip),
      C: C.slice(0, cTake).map(strip),
    },
    more: { B: B.length - bTake, C: C.length - cTake },
    mapsBuiltAt: maps.builtAt,
  }
}

// ── 建議採納追蹤(可追溯:這批建議之後有沒有真的被拜訪)──────────────
//
// 不動 Notion 拜訪紀錄 schema(databases.update 對這個 DB 已知會清掉既有選項,見上方
// ensureVisitDbFields 註解教訓)。改用 Redis 存「複製拜訪單」事件 log,
// 事後拿 scanVisitRecency() 的實際拜訪日回頭核對:複製後 N 天內該客戶有沒有新拜訪紀錄。

export type SuggestionCopyLogEntry = {
  at: string            // 複製時間 ISO
  salesperson: string
  city: string
  district: string
  customerIds: string[] // 這批被複製的客戶(依 group 分開存,方便算各組採納率)
  groups: Record<string, 'A' | 'B' | 'C'>  // customerId → group
}

const COPY_LOG_KEY = 'visit-suggestions:copy-log-v1'
const COPY_LOG_MAX = 300 // 約可覆蓋數月份

export async function logSuggestionCopy(entry: Omit<SuggestionCopyLogEntry, 'at'>): Promise<void> {
  if (!entry.customerIds.length) return
  const list = (await getRedisValue<SuggestionCopyLogEntry[]>(COPY_LOG_KEY)) ?? []
  list.unshift({ ...entry, at: new Date().toISOString() })
  await setRedisValue(COPY_LOG_KEY, list.slice(0, COPY_LOG_MAX), 400 * 24 * 60 * 60_000) // 約 13 個月
}

export type AdoptionStats = {
  totalCopies: number       // 複製拜訪單次數
  totalSuggested: number    // 累計被建議的客戶人次(含重複)
  totalVisited: number      // 其中複製後確實有被拜訪的人次
  rate: number              // totalVisited / totalSuggested(0~1,無資料回 0)
  byGroup: Record<'A' | 'B' | 'C', { suggested: number; visited: number }>
}

/** 某業務(或全部)近 N 天的建議採納率:複製建議後,該客戶是否在複製日之後被拜訪過。 */
export async function getSuggestionAdoptionStats(params: { salesperson?: string; sinceDays?: number } = {}): Promise<AdoptionStats> {
  const sinceDays = params.sinceDays ?? 30
  const sinceDate = new Date(Date.now() - sinceDays * 86400e3).toISOString().slice(0, 10)
  const [log, visitRecency] = await Promise.all([
    getRedisValue<SuggestionCopyLogEntry[]>(COPY_LOG_KEY),
    scanVisitRecency(),
  ])
  const entries = (log ?? []).filter((e) => e.at.slice(0, 10) >= sinceDate && (!params.salesperson || e.salesperson === params.salesperson))

  let totalSuggested = 0, totalVisited = 0
  const byGroup: AdoptionStats['byGroup'] = { A: { suggested: 0, visited: 0 }, B: { suggested: 0, visited: 0 }, C: { suggested: 0, visited: 0 } }
  for (const e of entries) {
    const copyDate = e.at.slice(0, 10)
    for (const cid of e.customerIds) {
      const key = cid.replace(/-/g, '')
      const g = e.groups[cid] ?? 'A'
      totalSuggested++
      byGroup[g].suggested++
      const lastVisit = visitRecency[key]
      if (lastVisit && lastVisit >= copyDate) {
        totalVisited++
        byGroup[g].visited++
      }
    }
  }

  return {
    totalCopies: entries.length,
    totalSuggested,
    totalVisited,
    rate: totalSuggested > 0 ? totalVisited / totalSuggested : 0,
    byGroup,
  }
}
