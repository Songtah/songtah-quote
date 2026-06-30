/**
 * lib/notion/dashboard.ts — 儀表板彙總（組合層）
 *
 * 這是「組合層」：跨多個 DB 做計數/摘要彙總。依架構原則，跨領域彙總只放這裡，
 * 不滲回各葉領域。彙總用輕量計數查詢（querySummary，shared），不需引入各葉領域的完整邏輯。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry, querySummary,
  getRedisValue, setRedisValue,
  getTitle, getText, getSelect, getDate, getRelationIds,
} from './shared'

export type ModuleSummary = {
  total: number
  hasMore?: boolean           // true when actual record count exceeds the fetched page
  activeThisMonth?: number    // unique active customers in current month (CRM only)
  recent: Array<{
    id: string
    title: string
    meta: string
    href?: string
  }>
}

export type DashboardSummary = {
  customers: ModuleSummary
  tickets: ModuleSummary
  opportunities: ModuleSummary
  products: ModuleSummary
  users: ModuleSummary
}

/**
 * Count unique customers who appear in visit records within the current month.
 * Deduplication uses relation ID first (more reliable), falling back to title name.
 */
async function getActiveCustomersThisMonth(): Promise<number> {
  if (!DB.visits) return 0

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  const uniqueCustomers = new Set<string>()
  let cursor: string | undefined

  do {
    const response: any = await notionCallWithRetry('activeCustomersThisMonth', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          and: [
            { property: '日期', date: { on_or_after: firstOfMonth } },
            { property: '日期', date: { on_or_before: lastOfMonth } },
          ],
        },
      })
    )

    for (const page of response.results ?? []) {
      // Prefer relation ID (stable) for deduplication
      const relIds = getRelationIds(page, '🏥 牙科單位資料')
      if (relIds.length > 0) {
        relIds.forEach((id: string) => uniqueCustomers.add(id))
      } else {
        // Fallback: use title as key
        const name = getTitle(page, '單位名稱').trim()
        if (name) uniqueCustomers.add(`name:${name}`)
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)

  return uniqueCustomers.size
}

async function getCustomersSummary(): Promise<ModuleSummary> {
  const [{ rows, total, hasMore }, activeThisMonth] = await Promise.all([
    querySummary(DB.customers),
    getActiveCustomersThisMonth(),
  ])
  return {
    total,
    hasMore,
    activeThisMonth,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '客戶名稱'),
      meta: [getSelect(page, '縣市'), getSelect(page, '客戶類型')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

/** Count tickets created in the current calendar month. */
async function getTicketsThisMonth(): Promise<number> {
  if (!DB.tickets) return 0
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  let count = 0
  let cursor: string | undefined
  do {
    const response: any = await notionCallWithRetry('ticketsThisMonth', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.tickets!),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          timestamp: 'created_time',
          created_time: { on_or_after: firstOfMonth },
        },
      })
    )
    count += (response.results ?? []).length
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

async function getTicketsSummary(): Promise<ModuleSummary> {
  const [{ rows, total, hasMore }, activeThisMonth] = await Promise.all([
    querySummary(DB.tickets),
    getTicketsThisMonth(),
  ])
  return {
    total,
    hasMore,
    activeThisMonth,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title:
        getTitle(page, '編號') ||
        getText(page, '案件標題') ||
        getText(page, '客戶單位') ||
        '未命名案件',
      meta: [getSelect(page, '狀態'), getSelect(page, '優先級')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getOpportunitiesSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.opportunities)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '商機名稱'),
      meta: [
        getText(page, '負責業務'),
        getSelect(page, '商機階段'),
        getDate(page, '下次跟進日'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getProductsSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.products)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, 'Name'),
      meta: [getSelect(page, '生產商'), getSelect(page, '分類')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getUsersSummary(): Promise<ModuleSummary> {
  const { rows, total, hasMore } = await querySummary(DB.users, 50)
  return {
    total,
    hasMore,
    recent: rows.slice(0, 20).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '帳號名稱'),
      meta: [
        getText(page, '帳號代碼'),
        getSelect(page, '帳號類型'),
        getSelect(page, '狀態'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const cached = await getRedisValue<DashboardSummary>('dashboard:summary:v3')
  if (cached) return cached

  const safe = async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn()
    } catch (error) {
      console.warn('dashboard summary warning:', error)
      return fallback
    }
  }

  const [customers, tickets, opportunities, products, users] = await Promise.all([
    safe(getCustomersSummary, { total: 0, recent: [] }),
    safe(getTicketsSummary, { total: 0, recent: [] }),
    safe(getOpportunitiesSummary, { total: 0, recent: [] }),
    safe(getProductsSummary, { total: 0, recent: [] }),
    safe(getUsersSummary, { total: 0, recent: [] }),
  ])

  const summary: DashboardSummary = { customers, tickets, opportunities, products, users }

  await setRedisValue('dashboard:summary:v3', summary, 300_000) // 5 min
  return summary
}

export async function getModuleRecords(module: keyof DashboardSummary) {
  const summary = await getDashboardSummary()
  return summary[module]
}

export async function getRoleSummary() {
  const users = await getUsersSummary()

  const counters = users.recent.reduce(
    (acc, item) => {
      if (item.meta.includes('業務')) acc.sales += 1
      if (item.meta.includes('中央管理')) acc.admin += 1
      if (item.meta.includes('行政')) acc.ops += 1
      return acc
    },
    { sales: 0, admin: 0, ops: 0 }
  )

  return counters
}
