import { todayTW } from '@/lib/ceo-stats'
import { listQuotes } from '@/lib/notion'
import { listOpenFollowUps, listVisits } from '@/lib/notion/visits'
import { listSystemTickets } from '@/lib/notion/tickets'

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
  }
  nextAction: TodayWorkItem | null
  workItems: TodayWorkItem[]
}

const ACTIVE_QUOTE_STATUSES = new Set(['草稿', '待行政審核', '待總經理審核', '已核准', '已送出'])
const CLOSED_TICKET_STATUSES = new Set(['✅ 結案', '已結案', '結案', '完成'])

function sameOwner(value: string, owner: string) {
  return value.trim().toLocaleLowerCase('zh-TW') === owner.trim().toLocaleLowerCase('zh-TW')
}

async function withDashboardTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), 2500)
      }),
    ])
  } catch (error) {
    console.error('dashboard data source unavailable:', error)
    return fallback
  } finally {
    if (timeout) clearTimeout(timeout)
  }
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
  access: { bd: boolean; quote: boolean; rma: boolean },
): Promise<TodayDashboardData> {
  const date = todayTW()
  if (!owner.trim()) {
    return {
      date,
      counts: { visits: 0, followUps: 0, quotes: 0, overdueTickets: 0 },
      nextAction: null,
      workItems: [],
    }
  }

  const [allVisits, allFollowUps, quoteResult, ticketResult] = await Promise.all([
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
    },
    nextAction: workItems[0] ?? null,
    workItems,
  }
}

/**
 * /bd 專用今日工作：一般業務只看本人；中央管理看全體業務摘要。
 * 不把管理帳號顯示名稱拿去查 Notion 的「業務人員」select，避免無效選項錯誤。
 */
export async function getBdTodayDashboard(owner: string, viewAll: boolean): Promise<TodayDashboardData> {
  if (!viewAll) return getTodayDashboard(owner, { bd: true, quote: false, rma: false })

  // 中央管理帳號沒有對應的「業務人員」select。不可為了首頁摘要即時掃描
  // 全體客情並解析所有 relation，否則會放大成大量 Notion request 並觸發 429。
  return {
    date: todayTW(),
    counts: { visits: 0, followUps: 0, quotes: 0, overdueTickets: 0 },
    nextAction: null,
    workItems: [],
  }
}
