import { todayTW } from '@/lib/ceo-stats'
import { listQuotes } from '@/lib/notion'
import { listOpenFollowUps, listVisits } from '@/lib/notion/visits'
import { listSystemTickets } from '@/lib/notion/tickets'
import { listTerritories } from '@/lib/notion/territories'
import { listPipelineCustomers } from '@/lib/notion/customers'
import { getSystemUserById, canAcceptNewBusiness } from '@/lib/notion/accounts'

export type TodayWorkItem = {
  id: string
  kind: 'visit' | 'follow-up' | 'quote' | 'ticket'
  time: string
  customer: string
  action: string
  href: string
  overdue?: boolean
}

export type TodayDashboardData = {
  date: string
  counts: {
    visits: number
    followUps: number
    quotes: number
    overdueTickets: number
    territoryNewOpenings: number
  }
  nextAction: TodayWorkItem | null
  workItems: TodayWorkItem[]
}

const ACTIVE_QUOTE_STATUSES = new Set(['草稿', '待行政審核', '待總經理審核', '已核准', '已送出'])
const CLOSED_TICKET_STATUSES = new Set(['✅ 結案', '已結案', '結案', '完成'])

function sameOwner(value: string, owner: string) {
  return value.trim().toLocaleLowerCase('zh-TW') === owner.trim().toLocaleLowerCase('zh-TW')
}

/**
 * 逾時就回退成 fallback，首頁不因單一資料源慢而整頁卡住。
 *
 * 個人視角 2.5s 夠用；全體視角要放寬——實測未結案待追蹤（219 筆、需解析 relation）
 * 要 3.8s、工單 2.1s，用 2.5s 會全部退回 fallback，首頁就變成一排 0
 * （這正是 2026-09-09 之前中央管理帳號看到全 0 的直接原因）。
 */
async function withDashboardTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } catch (error) {
    console.error('dashboard data source unavailable:', error)
    return fallback
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * 轄區「新機構」數：醫事監控從衛福部 BAS 掃到、匯入後尚未有人認領的新開業機構。
 *
 * 刻意不算「轄區內所有未認領客戶」——那是 6,000 筆量級的存量池（多數是從未進過
 * 開發漏斗的既有醫事機構），放在首頁沒有行動意義。首頁要回答的是「今天有什麼
 * 該趕快聯絡」，也就是剛掃到的新開業機構；存量池在轄區面板逐區處理。
 *
 * 條件：開發來源=BAS新開業、負責業務空白、且落在本人正式轄區內。
 * 轄區行政區留空＝整個縣市都算本人轄區。
 *
 * 必須與 /api/bd/pipeline 的可見範圍用同一道把關（canAcceptNewBusiness）：
 * 「既有客戶維護」模式的業務在跟進看板看不到未認領客戶、也無權認領，
 * 若首頁仍顯示筆數，點進去會是空的死路。帳號讀取失敗時一律回 0（fail-closed）。
 */
const BAS_NEW_OPENING_SOURCE = 'BAS新開業'

async function countTerritoryNewOpenings(salespersonId: string): Promise<number> {
  if (!salespersonId) return 0

  const account = await getSystemUserById(salespersonId).catch(() => null)
  if (!account || !canAcceptNewBusiness(account)) return 0

  const [territories, pipeline] = await Promise.all([
    listTerritories(),
    listPipelineCustomers(),
  ])
  const mine = territories.filter((t) => t.salespersonId === salespersonId)
  if (mine.length === 0) return 0

  const cityOnly = new Set(mine.filter((t) => !t.district).map((t) => t.city))
  const cityDistrict = new Set(mine.filter((t) => t.district).map((t) => `${t.city}|${t.district}`))

  return pipeline.filter((c) =>
    c.devSource === BAS_NEW_OPENING_SOURCE &&
    !c.salesperson.trim() &&
    (cityOnly.has(c.city) || cityDistrict.has(`${c.city}|${c.district}`))
  ).length
}

async function listOwnerTickets(owner: string) {
  try {
    return await listSystemTickets({ limit: 100, salesOwner: owner })
  } catch (error) {
    const notionError = error as { code?: string; message?: string }
    // Notion 的 select 遇到非選項值會直接拋錯。一般管理帳號沒有業務窗口選項，
    // 在「我的工作」首頁應視為沒有本人案件，而不是讓整頁故障。
    if (
      notionError.code === 'validation_error' &&
      notionError.message?.includes('not found for property "業務窗口"')
    ) {
      return { items: [], hasMore: false, nextCursor: null }
    }
    throw error
  }
}

export async function getTodayDashboard(
  owner: string,
  salespersonId: string,
  access: { bd: boolean; quote: boolean; rma: boolean },
): Promise<TodayDashboardData> {
  const date = todayTW()
  if (!owner.trim()) {
    return {
      date,
      counts: { visits: 0, followUps: 0, quotes: 0, overdueTickets: 0, territoryNewOpenings: 0 },
      nextAction: null,
      workItems: [],
    }
  }

  const [allVisits, allFollowUps, quoteResult, ticketResult, territoryNewOpenings] = await Promise.all([
    access.bd
      ? withDashboardTimeout(
          listVisits({ salesperson: owner, dateFrom: date, dateTo: date, fetchAll: true }).then((result) => result.items),
          [],
        )
      : Promise.resolve([]),
    access.bd ? withDashboardTimeout(listOpenFollowUps(owner), []) : Promise.resolve([]),
    access.quote
      ? withDashboardTimeout(
          listQuotes({ limit: 100, salesperson: owner }),
          { items: [], hasMore: false, nextCursor: null },
        )
      : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
    access.rma
      ? withDashboardTimeout(
          listOwnerTickets(owner),
          { items: [], hasMore: false, nextCursor: null },
        )
      : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
    access.bd ? withDashboardTimeout(countTerritoryNewOpenings(salespersonId), 0) : Promise.resolve(0),
  ])

  const visits = allVisits.filter((visit) => sameOwner(visit.salesperson, owner))
  const followUps = allFollowUps.filter((visit) => sameOwner(visit.salesperson, owner))
  const quotes = quoteResult.items.filter((quote) => ACTIVE_QUOTE_STATUSES.has(quote.status))
  const openTickets = ticketResult.items.filter((ticket) => !CLOSED_TICKET_STATUSES.has(ticket.status))
  const overdueTickets = openTickets.filter(
    (ticket) => ticket.scheduledDate && ticket.scheduledDate < date,
  )

  const visitItems: TodayWorkItem[] = visits.map((visit) => ({
    id: visit.id,
    kind: 'visit',
    time: '今天',
    customer: visit.customerName || '未命名客戶',
    action: visit.followUpAction || visit.interactionPurpose || '完成今日拜訪',
    href: '/bd',
  }))

  const followUpItems: TodayWorkItem[] = followUps.map((visit) => ({
    id: visit.id,
    kind: 'follow-up',
    time: visit.nextFollowUpDate || '待安排',
    customer: visit.customerName || '未命名客戶',
    action: visit.followUpAction || '完成客戶追蹤',
    href: '/bd',
    overdue: Boolean(visit.nextFollowUpDate && visit.nextFollowUpDate < date),
  }))

  const quoteItems: TodayWorkItem[] = quotes.slice(0, 2).map((quote) => ({
    id: quote.id,
    kind: 'quote',
    time: quote.status,
    customer: quote.customerName || '未命名客戶',
    action: quote.status === '草稿' ? '完成報價內容' : '追蹤報價進度',
    href: '/quotes',
  }))

  const ticketItems: TodayWorkItem[] = overdueTickets.slice(0, 2).map((ticket) => ({
    id: ticket.id,
    kind: 'ticket',
    time: ticket.scheduledDate,
    customer: ticket.customerName || '未命名客戶',
    action: '確認技術支援進度',
    href: `/tickets/${ticket.id}`,
    overdue: true,
  }))

  const workItems = [...visitItems, ...followUpItems, ...quoteItems, ...ticketItems]
    .sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)))
    .slice(0, 5)

  return {
    date,
    counts: {
      visits: visits.length,
      followUps: followUps.length,
      quotes: quotes.length,
      overdueTickets: overdueTickets.length,
      territoryNewOpenings,
    },
    nextAction: workItems[0] ?? null,
    workItems,
  }
}

/**
 * /bd 專用今日工作：一般業務只看本人；中央管理看全體業務摘要。
 * 不把管理帳號顯示名稱拿去查 Notion 的「業務人員」select，避免無效選項錯誤。
 */
export async function getBdTodayDashboard(owner: string, salespersonId: string, viewAll: boolean): Promise<TodayDashboardData> {
  if (!viewAll) return getTodayDashboard(owner, salespersonId, { bd: true, quote: false, rma: false })
  return getTeamTodayDashboard({ bd: true, quote: false, rma: false })
}

/**
 * 全體視角（中央管理／總經理／admin）。
 *
 * 這些帳號沒有對應的「業務人員」select 值，用個人視角會全部是 0。
 * 但也不能為了首頁摘要就即時全掃客情並解析所有 relation——那會放大成大量
 * Notion request 並觸發 429（2026-09-09 實測掃太兇確實會逾時）。
 * 因此只取「本來就已經按條件過濾、量體可控」的來源：
 *   當日拜訪（單日，數十筆）· 未結案待追蹤（已按客戶去重，約 250 筆）
 *   進行中報價（limit 100）· 未結案工單（limit 100）
 * 轄區新機構需要單一業務的轄區才有意義，全體視角不計算。
 */
/** 全體視角的逾時：實測最慢的待追蹤 3.8s，留一倍餘裕 */
const TEAM_TIMEOUT_MS = 10_000

export async function getTeamTodayDashboard(
  access: { bd: boolean; quote: boolean; rma: boolean },
): Promise<TodayDashboardData> {
  const date = todayTW()
  const [allVisits, allFollowUps, quoteResult, ticketResult] = await Promise.all([
    access.bd
      ? withDashboardTimeout(
          listVisits({ dateFrom: date, dateTo: date, fetchAll: true }).then((r) => r.items),
          [], TEAM_TIMEOUT_MS,
        )
      : Promise.resolve([]),
    access.bd ? withDashboardTimeout(listOpenFollowUps(), [], TEAM_TIMEOUT_MS) : Promise.resolve([]),
    access.quote
      ? withDashboardTimeout(listQuotes({ limit: 100 }), { items: [], hasMore: false, nextCursor: null }, TEAM_TIMEOUT_MS)
      : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
    access.rma
      ? withDashboardTimeout(listSystemTickets({ limit: 100 }), { items: [], hasMore: false, nextCursor: null }, TEAM_TIMEOUT_MS)
      : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
  ])

  const quotes = quoteResult.items.filter((q) => ACTIVE_QUOTE_STATUSES.has(q.status))
  const openTickets = ticketResult.items.filter((t) => !CLOSED_TICKET_STATUSES.has(t.status))
  const overdueTickets = openTickets.filter((t) => t.scheduledDate && t.scheduledDate < date)

  // 全體視角的工作佇列要標上是誰的，否則看不出來這筆該找誰
  const workItems: TodayWorkItem[] = [
    ...allFollowUps.map((v): TodayWorkItem => ({
      id: v.id,
      kind: 'follow-up',
      time: v.nextFollowUpDate || '待安排',
      customer: `${v.customerName || '未命名客戶'}（${v.salesperson || '未指派'}）`,
      action: v.followUpAction || '完成客戶追蹤',
      href: '/bd',
      overdue: Boolean(v.nextFollowUpDate && v.nextFollowUpDate < date),
    })),
    ...allVisits.map((v): TodayWorkItem => ({
      id: v.id,
      kind: 'visit',
      time: '今天',
      customer: `${v.customerName || '未命名客戶'}（${v.salesperson || '未指派'}）`,
      action: v.followUpAction || v.interactionPurpose || '今日已回報',
      href: '/bd',
    })),
  ]
    .sort((a, b) => Number(b.overdue ?? false) - Number(a.overdue ?? false))
    .slice(0, 30)

  return {
    date,
    counts: {
      visits: allVisits.length,
      followUps: allFollowUps.length,
      quotes: quotes.length,
      overdueTickets: overdueTickets.length,
      territoryNewOpenings: 0,
    },
    nextAction: null,
    workItems,
  }
}
