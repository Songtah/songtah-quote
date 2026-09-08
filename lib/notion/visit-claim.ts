/**
 * lib/notion/visit-claim.ts — 客情回報觸發認領（組合層）
 *
 * 這是跨領域彙總，依 CLAUDE.md「Notion 資料層架構原則」放在組合層：
 * 它 import 葉領域 customers／territories／accounts／visits／cross-support，
 * 葉領域彼此仍不互依。新增類似的跨領域判定請放這裡或上層 route，不要滲回葉領域。
 *
 * ── 為什麼不是「回報即認領」───────────────────────────────────────────────
 * 回報描述「已經發生的事」，認領宣告「未來的責任歸屬」，語意不同，不該共用一個動作；
 * 而認領是寫 Notion 客戶主檔的「負責業務」，錯了要人工回溯。
 *
 * 實測 5,891 筆客情紀錄（2026-09-08）：
 *   有客戶關聯 5,052 筆，其中業務有設轄區、可判斷的 2,942 筆
 *   → 落在自己轄區外 491 筆（16.7%），其中客戶未認領 314 筆
 *   → 若採「回報即認領」，這 314 筆會全部被錯誤計入回報者名下
 * 把 314 筆拆成「業務×客戶」組合共 239 組看回報次數：
 *   只回報 1 次 192 組（80%，支援/路過）· 2 次 33 組 · 3 次以上僅 14 組（真的在經營）
 *   另有 86/239 組該客戶已被其他業務拜訪過（有歸屬爭議）
 * 所以「回報次數」是支援與開發的分界線，而「是否有他人也拜訪過」是爭議訊號。
 *
 * 跨區支援報備現況只有 2 筆，證明沒人主動填——因此**不可**拿它當否決訊號。
 * 反過來做：使用者把建議標成「只是支援」時，順手替他建立報備紀錄。
 *
 * ── 三層機制 ─────────────────────────────────────────────────────────────
 * 第一層 轄區內 + 客戶未認領        → 自動認領（判定確定，無猜測空間）
 * 第二層 轄區外／業務未設轄區        → 只產生建議，不寫入；預設動作是「跨區支援」
 * 第三層 依回報次數與爭議度加權      → 2 次以上升級語氣；他人也拜訪過則需主管核可
 *
 * 注意：目前只有 4/8 位業務設了轄區（Gus 105 區、Hank 40、Eason 24、Duncan 13），
 * 其餘業務一律走第二層。補齊轄區設定後第一層才會對全體生效。
 *
 * ── 之後才設轄區怎麼辦（不回溯）─────────────────────────────────────────────
 * 新增轄區**不會**回頭把過去回報過的客戶自動認領——比照協作積分的「不回溯」政策，
 * 也避免「設個轄區」這種設定動作意外觸發客戶主檔的批次寫入。
 * 但這些筆也不能就這樣消失：實測若幫 Amy 補上她回報過的 50 個行政區，
 * 會有 81 筆建議（77 家客戶）從清單上不見、客戶卻仍然無人負責。
 * 因此改成第四種情況 `in-territory-backlog`——留在建議清單上，標明「這區現在是你的了」，
 * 一鍵認領即可。只有**設轄區之後的新回報**才走第一層自動認領。
 */
import { getCachedValue, setCachedValue, deleteRedisValue, getRedisValue, setRedisValue } from './shared'
import {
  NON_CLAIMABLE_OWNERS, listCustomersByArea, getAllSystemCustomers, type AreaCustomer,
} from './customers'
import { listTerritories } from './territories'
import { canAcceptNewBusiness, getSystemUsers } from './accounts'
import { scanVisitClaimSignals } from './visits'
import { isInactiveCustomer } from '@/lib/customer-status'

/** 同一「業務×客戶」累積達幾次回報，就從「疑似支援」升級為「疑似在開發」 */
export const DEVELOPING_VISIT_THRESHOLD = 2

export type ClaimSkipReason =
  | 'customer-unmatched'      // 回報沒比對到客戶（絕不亂猜）
  | 'already-owned'           // 客戶已有負責業務
  | 'non-claimable-owner'     // 公司／盤商，永不自動認領
  | 'inactive-customer'       // 已歇業／停業／撤銷
  | 'cannot-accept-business'  // 該業務為「既有客戶維護」模式
  | 'not-active-salesperson'  // 回報者不是目前可承接的業務帳號（離職／非業務／查無此人）

export type ClaimDecision =
  | { action: 'auto-claim'; territoryKey: string }
  | {
      action: 'suggest'
      tier: 'outside-territory' | 'no-territory' | 'in-territory-backlog'
      /** 該業務對該客戶累積回報次數 */
      visitCount: number
      /** 依 DEVELOPING_VISIT_THRESHOLD 判定像是在開發，而非單純支援 */
      looksDeveloping: boolean
      /** 該客戶另有其他業務也拜訪過 → 歸屬有爭議，需主管核可 */
      contested: boolean
      otherVisitors: string[]
    }
  | { action: 'skip'; reason: ClaimSkipReason }

export type ClaimContext = {
  /** 業務姓名 → 其有效轄區的 `縣市|行政區` 集合 */
  territoriesBy: Map<string, Set<string>>
  /** 業務姓名 → 是否可承接新客戶 */
  canClaimBy: Map<string, boolean>
}

const CONTEXT_CACHE_KEY = 'visit-claim-context-v1'
const CONTEXT_TTL = 10 * 60_000

/** 轄區與帳號承接模式的組合快照；兩者都不常變，快取 10 分鐘。 */
export async function loadClaimContext(): Promise<ClaimContext> {
  const cached = getCachedValue<{ t: [string, string[]][]; c: [string, boolean][] }>(CONTEXT_CACHE_KEY)
  if (cached) {
    return {
      territoriesBy: new Map(cached.t.map(([k, v]) => [k, new Set(v)])),
      canClaimBy: new Map(cached.c),
    }
  }
  const [territories, users] = await Promise.all([
    listTerritories().catch(() => []),
    getSystemUsers().catch(() => []),
  ])
  const territoriesBy = new Map<string, Set<string>>()
  for (const t of territories) {
    // 只有生效中的轄區算數；暫停／結束者不觸發自動認領
    if (t.status === '結束' || t.status === '暫停') continue
    if (!t.salesperson || !t.city || !t.district) continue
    const set = territoriesBy.get(t.salesperson) ?? new Set<string>()
    set.add(`${t.city}|${t.district}`)
    territoriesBy.set(t.salesperson, set)
  }
  const canClaimBy = new Map(users.map((u) => [u.name, canAcceptNewBusiness(u)]))

  setCachedValue(CONTEXT_CACHE_KEY, {
    t: Array.from(territoriesBy, ([k, v]) => [k, Array.from(v)] as [string, string[]]),
    c: Array.from(canClaimBy),
  }, CONTEXT_TTL)
  return { territoriesBy, canClaimBy }
}

export function invalidateClaimContext() {
  setCachedValue(CONTEXT_CACHE_KEY, null as any, 1)
  try { deleteRedisValue(CONTEXT_CACHE_KEY) } catch { /* 快取失效失敗不影響判定 */ }
}

/**
 * 對「某業務回報了某客戶」做出認領判定。純函式：所有輸入由呼叫端備齊，
 * 方便在 webhook、匯入、批次三個入口共用同一套規則。
 */
export function decideClaim(input: {
  salesperson: string
  customer: Pick<AreaCustomer, 'city' | 'district' | 'salesperson' | 'status'> | null
  context: ClaimContext
  /** 該業務對該客戶的累積回報次數（含本次） */
  visitCount: number
  /** 曾拜訪過該客戶的其他業務 */
  otherVisitors: string[]
  /**
   * true = 回放既有資料（每晚重算建議）。轄區內的舊回報不自動認領，
   * 改列為 in-territory-backlog 待人一鍵確認——不回溯政策，見檔頭說明。
   * false/省略 = 即時路徑（建檔當下），轄區內直接認領。
   */
  retroactive?: boolean
}): ClaimDecision {
  const { salesperson, customer, context, visitCount, otherVisitors, retroactive } = input

  if (!customer) return { action: 'skip', reason: 'customer-unmatched' }
  const owner = (customer.salesperson ?? '').trim()
  if (owner && NON_CLAIMABLE_OWNERS.has(owner)) return { action: 'skip', reason: 'non-claimable-owner' }
  if (owner) return { action: 'skip', reason: 'already-owned' }
  if (isInactiveCustomer(customer.status)) return { action: 'skip', reason: 'inactive-customer' }

  // 「既有客戶維護」模式的業務不得承接新客戶——與 /api/territories/[id]/claim 同一道把關。
  // **fail-closed**：查無此帳號一律不給（離職業務與非業務帳號的舊回報仍留在拜訪庫裡，
  // 若只擋 === false，undefined 會漏過去，實測會讓 Chloe🍒／洪爺／Ted 也收到建議）。
  const canClaim = context.canClaimBy.get(salesperson)
  if (canClaim !== true) {
    return { action: 'skip', reason: canClaim === false ? 'cannot-accept-business' : 'not-active-salesperson' }
  }

  const territories = context.territoriesBy.get(salesperson)
  const key = `${customer.city}|${customer.district}`

  const contested = otherVisitors.filter((n) => n && n !== salesperson)
  const inTerritory = territories?.has(key) ?? false

  // 第一層：自己轄區內且無人負責 → 判定確定，直接認領。
  // 但回放既有資料時不回溯，改列待辦（否則「補設轄區」會變成批次改客戶主檔）。
  if (inTerritory && !retroactive) return { action: 'auto-claim', territoryKey: key }

  // 第二層＋第三層：轄區外／沒設轄區／轄區內的舊回報 → 只建議，並附上加權訊號
  return {
    action: 'suggest',
    tier: inTerritory ? 'in-territory-backlog'
      : territories && territories.size > 0 ? 'outside-territory' : 'no-territory',
    visitCount,
    looksDeveloping: visitCount >= DEVELOPING_VISIT_THRESHOLD,
    contested: contested.length > 0,
    otherVisitors: contested,
  }
}

/** 建議卡片要顯示的文案；集中在此，webhook 回覆與頁面共用同一套說法。 */
export function describeDecision(d: ClaimDecision, customerName: string): string {
  switch (d.action) {
    case 'auto-claim':
      return `${customerName} 在你的轄區內且尚無人負責，已自動認領給你。`
    case 'suggest': {
      const where = d.tier === 'in-territory-backlog' ? '這區現在是你的轄區了'
        : d.tier === 'no-territory' ? '你目前沒有設定轄區' : '這家不在你的轄區內'
      const nth = d.looksDeveloping ? `你已經回報過這家 ${d.visitCount} 次，看起來是你在開發。` : ''
      const war = d.contested ? `另有 ${d.otherVisitors.join('、')} 也拜訪過這家，認領需主管核可。` : ''
      return `${customerName}：${where}，所以沒有自動認領。${nth}${war}`.trim()
    }
    case 'skip':
      return ''
  }
}

/** 判定所需的客戶資料；比對不到就回 null，絕不用相近名稱猜。 */
export async function findClaimTargetCustomer(
  customerId: string,
  city: string,
  district: string,
): Promise<AreaCustomer | null> {
  if (!customerId) return null
  const rows = await listCustomersByArea({ city, district }).catch(() => [] as AreaCustomer[])
  return rows.find((c) => c.id.replace(/-/g, '') === customerId.replace(/-/g, '')) ?? null
}


// ── 建議清單 ────────────────────────────────────────────────────────────────

export type ClaimSuggestion = {
  customerId: string
  customerName: string
  customerCity: string
  customerDistrict: string
  customerType: string
  salesperson: string
  tier: 'outside-territory' | 'no-territory' | 'in-territory-backlog'
  visitCount: number
  looksDeveloping: boolean
  contested: boolean
  otherVisitors: string[]
  lastVisitDate: string
}

const SUGGESTIONS_CACHE_KEY = 'visit-claim-suggestions-v1'
const SUGGESTIONS_TTL = 12 * 60 * 60_000   // 12 小時；由每晚排程重算保持新鮮

/**
 * 全庫推導「待認領建議」：某業務回報過、但客戶仍無人負責、且不在其轄區內者。
 *
 * 刻意不另建資料表——建議是純推導結果：客戶一旦有了負責業務，該筆建議自然消失；
 * 使用者標「只是支援」時建立跨區支援報備（見 dismissClaimSuggestion），
 * 之後靠 dismissed 名單濾掉。少一張表就少一份會跟現實脫節的狀態。
 *
 * 全掃拜訪庫＋客戶庫，屬重運算，走快取；由每晚排程 refresh 呼叫。
 */
export async function computeClaimSuggestions(): Promise<ClaimSuggestion[]> {
  const [signals, customers, context, dismissed] = await Promise.all([
    scanVisitClaimSignals(),
    getAllSystemCustomers(),
    loadClaimContext(),
    loadDismissed(),
  ])
  const byId = new Map(customers.map((c) => [c.id.replace(/-/g, ''), c]))

  const out: ClaimSuggestion[] = []
  for (const [customerId, signal] of Object.entries(signals)) {
    const customer = byId.get(customerId)
    if (!customer) continue
    const visitors = Object.keys(signal.visitors)
    for (const salesperson of visitors) {
      if (dismissed.has(dismissKey(salesperson, customerId))) continue
      const decision = decideClaim({
        salesperson, customer, context,
        visitCount: signal.visitors[salesperson] ?? 0,
        otherVisitors: visitors,
        retroactive: true,   // 回放既有資料：轄區內的舊回報列待辦，不自動認領
      })
      if (decision.action !== 'suggest') continue
      out.push({
        customerId,
        customerName: customer.name,
        customerCity: customer.city,
        customerDistrict: customer.district,
        customerType: customer.type,
        salesperson,
        tier: decision.tier,
        visitCount: decision.visitCount,
        looksDeveloping: decision.looksDeveloping,
        contested: decision.contested,
        otherVisitors: decision.otherVisitors,
        lastVisitDate: signal.lastDate,
      })
    }
  }
  // 像在開發的排前面，其次回報次數多的，最後才是單次支援
  // 轄區內待辦排最前（歸屬最明確、最該一鍵清掉），其次像在開發的，最後才是單次支援
  out.sort((a, b) =>
    Number(b.tier === 'in-territory-backlog') - Number(a.tier === 'in-territory-backlog') ||
    Number(b.looksDeveloping) - Number(a.looksDeveloping) ||
    b.visitCount - a.visitCount ||
    b.lastVisitDate.localeCompare(a.lastVisitDate))

  await setRedisValue(SUGGESTIONS_CACHE_KEY, out, SUGGESTIONS_TTL)
  return out
}

/** 只讀快取；沒有就即時算一次（首次開頁會慢，之後由排程保持 warm）。 */
export async function listClaimSuggestions(salesperson?: string): Promise<ClaimSuggestion[]> {
  const cached = await getRedisValue<ClaimSuggestion[]>(SUGGESTIONS_CACHE_KEY)
  const all = cached ?? await computeClaimSuggestions()
  return salesperson ? all.filter((s) => s.salesperson === salesperson) : all
}

export async function invalidateClaimSuggestions() {
  try { deleteRedisValue(SUGGESTIONS_CACHE_KEY) } catch { /* 失效失敗下次仍會過期 */ }
}

// ── 「只是支援」的否決名單 ──────────────────────────────────────────────────
// 存 Redis 而非 Notion：這是 UI 狀態不是業務事實，業務事實已寫進跨區支援報備。

const DISMISSED_KEY = 'visit-claim-dismissed-v1'
const DISMISSED_TTL = 400 * 24 * 60 * 60_000   // 約 13 個月，跨年度不重複打擾

const dismissKey = (salesperson: string, customerId: string) =>
  `${salesperson}|${customerId.replace(/-/g, '')}`

async function loadDismissed(): Promise<Set<string>> {
  return new Set((await getRedisValue<string[]>(DISMISSED_KEY)) ?? [])
}

export async function addDismissed(salesperson: string, customerId: string) {
  const set = await loadDismissed()
  set.add(dismissKey(salesperson, customerId))
  await setRedisValue(DISMISSED_KEY, Array.from(set), DISMISSED_TTL)
}

// ── 第一層：建檔當下的自動認領 ──────────────────────────────────────────────

/**
 * 客情紀錄建檔後呼叫：只在「轄區內 + 客戶無人負責」時直接認領。
 *
 * 走即時路徑，所以刻意不算回報次數與爭議度——那兩個訊號只在「建議」分支用得到，
 * 而建議由每晚的 computeClaimSuggestions 全庫重算產生，不需要在這裡付全掃的代價。
 *
 * unambiguous=false（客戶名稱比對到多筆）時一律不認領：寧可漏，不可錯掛。
 * 永不 throw——認領失敗不該讓客情建檔跟著失敗。
 */
export async function applyAutoClaimForVisit(input: {
  salesperson: string
  customerId: string
  unambiguous: boolean
}): Promise<{ claimed: boolean; reason: string }> {
  const { salesperson, customerId, unambiguous } = input
  if (!salesperson || !customerId) return { claimed: false, reason: 'missing-input' }
  if (!unambiguous) return { claimed: false, reason: 'ambiguous-customer-match' }

  try {
    const [customers, context] = await Promise.all([getAllSystemCustomers(), loadClaimContext()])
    const bare = customerId.replace(/-/g, '')
    const customer = customers.find((c) => c.id.replace(/-/g, '') === bare)
    const decision = decideClaim({ salesperson, customer: customer ?? null, context, visitCount: 1, otherVisitors: [] })
    if (decision.action !== 'auto-claim') {
      return { claimed: false, reason: decision.action === 'skip' ? decision.reason : decision.tier }
    }

    // assignSalesperson 逐筆重讀、只寫負責業務空白者（零覆蓋鐵則），此處不繞過
    const { assignSalesperson } = await import('./customers')
    const result = await assignSalesperson([customer!.id], salesperson)
    if (result.assigned > 0) {
      await invalidateClaimSuggestions()
      invalidateClaimContext()
      return { claimed: true, reason: decision.territoryKey }
    }
    return { claimed: false, reason: 'already-taken' }
  } catch (error) {
    console.error('applyAutoClaimForVisit error:', error)
    return { claimed: false, reason: 'error' }
  }
}
