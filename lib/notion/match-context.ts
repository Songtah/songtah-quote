/**
 * lib/notion/match-context.ts — 客情名稱比對的消歧義脈絡（組合層）
 *
 * 為什麼需要：日報寫的是口語簡稱，主檔字根大量重複——實測 7,903 個字根有 1,216 組重複，
 * 其中「兩字字根」5,174 個裡就有 1,086 個重複（全美 14 家、微笑 13、陽明 13、國泰 10）。
 * 舊規則「候選不唯一就放棄」因此在 824 筆未配對紀錄裡放掉了 457 筆（55%）。
 *
 * 解法不是放寬字數門檻（那只會讓歧義更嚴重），而是補上日報本來就帶著的兩個訊號：
 * **誰回報的**、**他負責哪裡**。實測四層由強到弱可解掉 348/457 筆：
 *   ① 轄區（縣市＋行政區）109 筆　② 轄區縣市 13 筆　③ 實際活動縣市 154 筆　④ 歷史往來 72 筆
 *
 * 轄區排最前面是因為它是人為定義、可控的；目前只有 4 位業務設了轄區
 * （Gus 105 區、Hank 40、Eason 24、Duncan 13，Amy 與 Sam 皆無），
 * 所以③④是過渡手段——轄區補齊後這兩層的依賴會自然下降。
 *
 * 依 CLAUDE.md 資料層架構：本檔 import 多個葉領域（territories 經 visit-claim、visits、customers），
 * 屬組合層；葉領域彼此仍不互依。全掃拜訪庫很重，一律走快取，禁止在建檔路徑直接重算
 * （webhook 曾因建檔路徑全掃客戶庫 60 秒逾時）。
 */
import { getRedisValue, setRedisValue, getCachedValue, setCachedValue } from './shared'
import { getAllSystemCustomers } from './customers'
import { scanVisitClaimSignals } from './visits'
import { loadClaimContext } from './visit-claim'
import type { MatchNarrowing } from '@/lib/customer-name-match'

export type MatchContext = {
  /** 業務 → 轄區鍵「縣市|行政區」 */
  territoriesBy: Map<string, Set<string>>
  /** 業務 → 轄區涵蓋的縣市 */
  territoryCitiesBy: Map<string, Set<string>>
  /** 業務 → 實際活動縣市（由拜訪紀錄推導，供未設轄區者使用） */
  activeCitiesBy: Map<string, Set<string>>
  /** 業務 → 曾拜訪過的客戶 id（去連字號） */
  visitedBy: Map<string, Set<string>>
  /** 所有曾被拜訪過的客戶 id（不分業務）——供「已往來客戶數」以實證判斷 */
  visitedCustomers: Set<string>
}

const KEY = 'match-context-v2'   // v2＝加上全體已拜訪客戶集合
const TTL_MS = 36 * 3600_000       // 每晚重算；多給一天半緩衝，排程失敗也不會立刻退化
const MEM_TTL = 10 * 60_000

type Serialized = {
  t: [string, string[]][]
  tc: [string, string[]][]
  ac: [string, string[]][]
  v: [string, string[]][]
  all?: string[]
}

const toMap = (rows: [string, string[]][]) => new Map(rows.map(([k, v]) => [k, new Set(v)]))
const fromMap = (m: Map<string, Set<string>>) =>
  Array.from(m, ([k, v]) => [k, Array.from(v)] as [string, string[]])

const EMPTY: MatchContext = {
  territoriesBy: new Map(), territoryCitiesBy: new Map(),
  activeCitiesBy: new Map(), visitedBy: new Map(), visitedCustomers: new Set(),
}

const hydrate = (s: Serialized): MatchContext => ({
  territoriesBy: toMap(s.t), territoryCitiesBy: toMap(s.tc),
  activeCitiesBy: toMap(s.ac), visitedBy: toMap(s.v),
  visitedCustomers: new Set(s.all ?? []),
})

/**
 * 讀脈絡：記憶體 → Redis → （都沒有才）重算。
 * 重算會全掃拜訪庫與客戶庫，正常情況由每晚排程做；請求路徑拿不到快取時寧可退化成空脈絡，
 * 也不要在這裡阻塞——空脈絡只會讓比對回到「唯一才配」的舊行為，不會配錯。
 */
export async function loadMatchContext(options?: { allowRebuild?: boolean }): Promise<MatchContext> {
  const mem = getCachedValue<Serialized>(KEY)
  if (mem) return hydrate(mem)
  const cached = await getRedisValue<Serialized>(KEY).catch(() => null)
  if (cached) {
    setCachedValue(KEY, cached, MEM_TTL)
    return hydrate(cached)
  }
  if (!options?.allowRebuild) return EMPTY
  return await rebuildMatchContext()
}

/** 全掃重算並寫入快取。由 /api/cron/refresh-region-stats 那批夜間排程呼叫。 */
export async function rebuildMatchContext(): Promise<MatchContext> {
  const [claim, signals, customers] = await Promise.all([
    loadClaimContext().catch(() => null),
    scanVisitClaimSignals().catch(() => ({} as Record<string, { visitors: Record<string, number>; lastDate: string }>)),
    getAllSystemCustomers().catch(() => []),
  ])

  const territoriesBy = claim?.territoriesBy ?? new Map<string, Set<string>>()
  const territoryCitiesBy = new Map<string, Set<string>>()
  for (const [sp, keys] of Array.from(territoriesBy.entries())) {
    const cities = new Set<string>()
    for (const k of Array.from(keys)) cities.add(k.split('|')[0])
    territoryCitiesBy.set(sp, cities)
  }

  const cityById = new Map(customers.map((c) => [c.id.replace(/-/g, ''), c.city]))
  const visitedBy = new Map<string, Set<string>>()
  const cityCount = new Map<string, Map<string, number>>()
  for (const [cid, sig] of Object.entries(signals)) {
    const city = cityById.get(cid) ?? ''
    for (const [sp, times] of Object.entries(sig.visitors ?? {})) {
      if (!sp || !times) continue
      const set = visitedBy.get(sp) ?? new Set<string>()
      set.add(cid)
      visitedBy.set(sp, set)
      if (!city) continue
      const cc = cityCount.get(sp) ?? new Map<string, number>()
      cc.set(city, (cc.get(city) ?? 0) + times)
      cityCount.set(sp, cc)
    }
  }

  // 活動縣市：至少 5 次、且佔該業務拜訪量 5% 以上——擋掉偶爾支援一趟的外縣市
  const activeCitiesBy = new Map<string, Set<string>>()
  for (const [sp, cc] of Array.from(cityCount.entries())) {
    const total = Array.from(cc.values()).reduce((a: number, b: number) => a + b, 0)
    const set = new Set<string>()
    for (const [city, n] of Array.from(cc.entries())) if (n >= 5 && n >= total * 0.05) set.add(city)
    activeCitiesBy.set(sp, set)
  }

  const payload: Serialized = {
    t: fromMap(territoriesBy), tc: fromMap(territoryCitiesBy),
    ac: fromMap(activeCitiesBy), v: fromMap(visitedBy),
    all: Object.keys(signals),
  }
  setCachedValue(KEY, payload, MEM_TTL)
  await setRedisValue(KEY, payload, TTL_MS).catch(() => { /* 沒有 Redis（本機）不影響本次 */ })
  return hydrate(payload)
}

/** 取某業務的消歧義條件；業務為空或沒有任何脈絡時回 undefined（＝回到舊規則）。 */
export function narrowingFor(ctx: MatchContext, salesperson: string): MatchNarrowing | undefined {
  if (!salesperson) return undefined
  const n: MatchNarrowing = {
    territories: ctx.territoriesBy.get(salesperson),
    territoryCities: ctx.territoryCitiesBy.get(salesperson),
    activeCities: ctx.activeCitiesBy.get(salesperson),
    visitedCustomerIds: ctx.visitedBy.get(salesperson),
  }
  return (n.territories?.size || n.territoryCities?.size || n.activeCities?.size || n.visitedCustomerIds?.size)
    ? n : undefined
}
