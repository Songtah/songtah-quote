/**
 * CEO Dashboard & Daily Report — Notion data layer
 *
 * Lightweight queries (no item fetching) so the dashboard stays fast.
 * All results are cached in Redis / in-memory for 10-15 min.
 */
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const ORDERS_DB   = process.env.NOTION_ORDERS_DB!
const VISITS_DB   = process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16'
const QUOTES_DB   = process.env.NOTION_QUOTES_DB!
const TICKETS_DB  =
  process.env.NOTION_TICKETS_SYSTEM_DB ??
  process.env.NOTION_TICKETS_DB ??
  '285dcdaa-fb2a-81d9-b434-f8c5c43d006b'

// ── Tiny in-memory cache (resets on cold start) ────────────────
const _cache = new Map<string, { v: unknown; exp: number }>()
function fromCache<T>(key: string): T | null {
  const hit = _cache.get(key)
  return hit && Date.now() < hit.exp ? (hit.v as T) : null
}
function toCache<T>(key: string, v: T, ttlMs: number) {
  _cache.set(key, { v, exp: Date.now() + ttlMs })
}

// ── Date helpers ───────────────────────────────────────────────
function tzDate(offsetHours = 8): Date {
  return new Date(Date.now() + offsetHours * 3600_000)
}

export function todayTW(): string {
  return tzDate().toISOString().slice(0, 10)
}

/** YYYY-MM-DD for first day of a month offset (0 = current, -1 = last, etc.) */
function monthStart(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD for last day of a month offset */
function monthEnd(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset + 1)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** "2026-05" label */
function monthLabel(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 7)
}

// ── Notion page helpers ────────────────────────────────────────
function getProp(page: any, field: string) {
  return page.properties?.[field]
}
function getSelect(page: any, field: string): string {
  return getProp(page, field)?.select?.name ?? ''
}
function getText(page: any, field: string): string {
  const p = getProp(page, field)
  if (!p) return ''
  if (p.type === 'rich_text') return p.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  if (p.type === 'title')     return p.title?.map((t: any) => t.plain_text).join('') ?? ''
  return ''
}
function getDate(page: any, field: string): string {
  return getProp(page, field)?.date?.start ?? ''
}
function getTitle(page: any, field: string): string {
  const p = getProp(page, field)
  if (!p) return ''
  if (p.type === 'title') return p.title?.map((t: any) => t.plain_text).join('') ?? ''
  return getText(page, field)
}
function getCheckbox(page: any, field: string): boolean {
  return getProp(page, field)?.checkbox ?? false
}

// ── Generic paginated query (no items, just page rows) ─────────
async function queryAll(
  database_id: string,
  filter?: any,
  sorts?: any[]
): Promise<any[]> {
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id,
      ...(filter ? { filter } : {}),
      ...(sorts  ? { sorts  } : {}),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any)
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results
}

// ═══════════════════════════════════════════════════════════════
// Orders stats
// ═══════════════════════════════════════════════════════════════

export interface OrderStat {
  date: string
  salesperson: string
  status: string
  totalAmount: number
  customerName: string
}

/** Fetch lightweight order stats (no items) for a date range */
async function fetchOrderStats(from: string, to: string): Promise<OrderStat[]> {
  const pages = await queryAll(
    ORDERS_DB,
    {
      and: [
        { property: '日期', date: { on_or_after: from } },
        { property: '日期', date: { on_or_before: to  } },
      ],
    },
    [{ property: '日期', direction: 'descending' }]
  )

  return pages.map((p) => ({
    date:         getDate(p, '日期'),
    salesperson:  getText(p, '業務'),
    status:       getSelect(p, '狀態'),
    totalAmount:  p.properties?.['總金額']?.number ?? 0,
    customerName: getText(p, '客戶名稱'),
  }))
}

// ═══════════════════════════════════════════════════════════════
// Visits stats
// ═══════════════════════════════════════════════════════════════

export interface VisitStat {
  date: string
  salesperson: string
  customerName: string
  interactionType: string
  interactionPurpose: string
  customerReaction: string
  followUpAction: string
  needsFollowUp: boolean
  nextFollowUpDate: string
  content: string
  city: string
}

/** Fetch visit stats for a date range */
async function fetchVisitStats(from: string, to: string): Promise<VisitStat[]> {
  const pages = await queryAll(
    VISITS_DB,
    {
      and: [
        { property: '日期', date: { on_or_after: from } },
        { property: '日期', date: { on_or_before: to  } },
      ],
    },
    [{ property: '日期', direction: 'descending' }]
  )

  return pages.map((p) => ({
    date:             getDate(p, '日期'),
    salesperson:      getSelect(p, '業務人員') || getText(p, '業務人員'),
    customerName:     getTitle(p, '單位名稱'),
    interactionType:  getSelect(p, '互動類型'),
    interactionPurpose: getSelect(p, '互動目的'),
    customerReaction: getSelect(p, '客戶反應'),
    followUpAction:   getText(p, '後續動作'),
    needsFollowUp:    getCheckbox(p, '是否需追蹤'),
    nextFollowUpDate: getDate(p, '下次追蹤日'),
    content:          getText(p, '拜訪內容'),
    city:             p.properties?.['縣市']?.rollup?.array?.[0]?.select?.name
                      ?? getSelect(p, '縣市')
                      ?? getText(p, '縣市'),
  }))
}

/** Fetch today's visits (for daily report) */
export async function fetchTodayVisits(): Promise<VisitStat[]> {
  const today = todayTW()
  return fetchVisitStats(today, today)
}

/** Fetch visits with pending follow-up (needsFollowUp = true) */
export async function fetchPendingFollowUps(): Promise<VisitStat[]> {
  const pages = await queryAll(VISITS_DB, {
    property: '是否需追蹤',
    checkbox: { equals: true },
  })
  return pages.map((p) => ({
    date:             getDate(p, '日期'),
    salesperson:      getSelect(p, '業務人員') || getText(p, '業務人員'),
    customerName:     getTitle(p, '單位名稱'),
    interactionType:  getSelect(p, '互動類型'),
    interactionPurpose: getSelect(p, '互動目的'),
    customerReaction: getSelect(p, '客戶反應'),
    followUpAction:   getText(p, '後續動作'),
    needsFollowUp:    true,
    nextFollowUpDate: getDate(p, '下次追蹤日'),
    content:          getText(p, '拜訪內容'),
    city:             p.properties?.['縣市']?.rollup?.array?.[0]?.select?.name
                      ?? getSelect(p, '縣市')
                      ?? getText(p, '縣市'),
  }))
}

// ═══════════════════════════════════════════════════════════════
// Quotes stats
// ═══════════════════════════════════════════════════════════════

export interface QuoteStat {
  date: string
  salesperson: string
  status: string
  total: number
}

async function fetchQuoteStats(from: string, to: string): Promise<QuoteStat[]> {
  const pages = await queryAll(
    QUOTES_DB,
    {
      and: [
        { property: '建立時間', created_time: { on_or_after:  `${from}T00:00:00.000Z` } },
        { property: '建立時間', created_time: { on_or_before: `${to}T23:59:59.999Z`   } },
      ],
    }
  )
  return pages.map((p) => ({
    date:        p.created_time?.slice(0, 10) ?? '',
    salesperson: getText(p, '業務姓名'),
    status:      getSelect(p, '狀態') || '草稿',
    total:       p.properties?.['總金額']?.number ?? 0,
  }))
}

// ═══════════════════════════════════════════════════════════════
// CEO Dashboard — full stats
// ═══════════════════════════════════════════════════════════════

export interface SalespersonStat {
  name: string
  visits: number
  orders: number
  amount: number
  followUps: number
}

export interface MonthlyTrend {
  month: string   // "2026-05"
  label: string   // "5月"
  orders: number
  amount: number
  visits: number
  quotes: number
}

export interface CEOStats {
  // 本月
  thisMonth: {
    ordersCount:  number
    ordersAmount: number
    quotesCount:  number
    visitsCount:  number
    pendingFollowUps: number
  }
  // 本月 vs 上月
  lastMonth: {
    ordersAmount: number
    visitsCount:  number
  }
  // 業務員排行
  salespersonStats: SalespersonStat[]
  // 近6個月趨勢
  monthlyTrend: MonthlyTrend[]
  // 訂單狀態分佈
  ordersByStatus: Record<string, number>
  // 報價轉換率（本月）
  quoteConversionRate: number
  generatedAt: string
}

export async function getCEOStats(): Promise<CEOStats> {
  const cacheKey = 'ceo-stats:v1'
  const cached = fromCache<CEOStats>(cacheKey)
  if (cached) return cached

  const sixMonthsAgo = monthStart(-5)
  const today        = todayTW()

  // Fetch 6 months of data in parallel
  const [allOrders, allVisits, allQuotes, pendingFU] = await Promise.all([
    fetchOrderStats(sixMonthsAgo, today),
    fetchVisitStats(sixMonthsAgo, today),
    fetchQuoteStats(sixMonthsAgo, today),
    fetchPendingFollowUps(),
  ])

  // ── Monthly trend (6 months) ──
  const monthlyTrend: MonthlyTrend[] = Array.from({ length: 6 }, (_, i) => {
    const offset = i - 5  // -5 → 0 (oldest → current)
    const m = monthLabel(offset)
    const from = monthStart(offset)
    const to   = monthEnd(offset)

    const monthOrders = allOrders.filter(
      (o) => o.date >= from && o.date <= to && o.status !== '已取消'
    )
    const monthVisits = allVisits.filter((v) => v.date >= from && v.date <= to)
    const monthQuotes = allQuotes.filter((q) => q.date >= from && q.date <= to)

    return {
      month:  m,
      label:  `${parseInt(m.slice(5))}月`,
      orders: monthOrders.length,
      amount: monthOrders.reduce((s, o) => s + o.totalAmount, 0),
      visits: monthVisits.length,
      quotes: monthQuotes.length,
    }
  })

  // ── This month stats ──
  const curFrom = monthStart(0)
  const curTo   = monthEnd(0)
  const thisMonthOrders = allOrders.filter(
    (o) => o.date >= curFrom && o.date <= curTo && o.status !== '已取消'
  )
  const thisMonthVisits = allVisits.filter((v) => v.date >= curFrom && v.date <= curTo)
  const thisMonthQuotes = allQuotes.filter((q) => q.date >= curFrom && q.date <= curTo)

  // ── Last month stats ──
  const prevFrom = monthStart(-1)
  const prevTo   = monthEnd(-1)
  const lastMonthOrders = allOrders.filter(
    (o) => o.date >= prevFrom && o.date <= prevTo && o.status !== '已取消'
  )
  const lastMonthVisits = allVisits.filter((v) => v.date >= prevFrom && v.date <= prevTo)

  // ── Salesperson ranking (this month) ──
  const spMap: Record<string, SalespersonStat> = {}
  for (const v of thisMonthVisits) {
    const name = v.salesperson || '（未填）'
    if (!spMap[name]) spMap[name] = { name, visits: 0, orders: 0, amount: 0, followUps: 0 }
    spMap[name].visits++
    if (v.needsFollowUp) spMap[name].followUps++
  }
  for (const o of thisMonthOrders) {
    const name = o.salesperson || '（未填）'
    if (!spMap[name]) spMap[name] = { name, visits: 0, orders: 0, amount: 0, followUps: 0 }
    spMap[name].orders++
    spMap[name].amount += o.totalAmount
  }
  const salespersonStats = Object.values(spMap).sort((a, b) => b.amount - a.amount || b.visits - a.visits)

  // ── Order status distribution (this month) ──
  const ordersByStatus: Record<string, number> = {}
  for (const o of allOrders.filter((o) => o.date >= curFrom && o.date <= curTo)) {
    ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1
  }

  // ── Quote conversion rate ──
  const sentQuotes  = thisMonthQuotes.filter((q) => q.status !== '草稿').length
  const conversionRate = sentQuotes > 0
    ? Math.round((thisMonthOrders.length / sentQuotes) * 100)
    : 0

  const stats: CEOStats = {
    thisMonth: {
      ordersCount:      thisMonthOrders.length,
      ordersAmount:     thisMonthOrders.reduce((s, o) => s + o.totalAmount, 0),
      quotesCount:      thisMonthQuotes.length,
      visitsCount:      thisMonthVisits.length,
      pendingFollowUps: pendingFU.length,
    },
    lastMonth: {
      ordersAmount: lastMonthOrders.reduce((s, o) => s + o.totalAmount, 0),
      visitsCount:  lastMonthVisits.length,
    },
    salespersonStats,
    monthlyTrend,
    ordersByStatus,
    quoteConversionRate: conversionRate,
    generatedAt: new Date().toISOString(),
  }

  toCache(cacheKey, stats, 15 * 60_000) // 15 min
  return stats
}

// ═══════════════════════════════════════════════════════════════
// Daily Report Builder
// ═══════════════════════════════════════════════════════════════

export interface DailyReportData {
  date: string
  period: 'AM' | 'PM' | 'FULL'
  visits: VisitStat[]
  todayOrders: OrderStat[]
  pendingFollowUps: number
}

export async function buildDailyReportData(
  date: string,
  period: 'AM' | 'PM' | 'FULL' = 'FULL'
): Promise<DailyReportData> {
  const [visits, todayOrders, pendingFU] = await Promise.all([
    fetchVisitStats(date, date),
    fetchOrderStats(date, date),
    fetchPendingFollowUps(),
  ])

  // AM = morning visits only (approximated by first half), or use all for FULL
  const filteredVisits =
    period === 'AM'
      ? visits.slice(0, Math.ceil(visits.length / 2))
      : visits

  return {
    date,
    period,
    visits: filteredVisits,
    todayOrders: todayOrders.filter((o) => o.status !== '已取消'),
    pendingFollowUps: pendingFU.length,
  }
}

/** Format report data into a LINE message string */
export function formatDailyReport(data: DailyReportData): string {
  const { date, period, visits, todayOrders, pendingFollowUps } = data

  const periodLabel = period === 'AM' ? '上午場 ☀️' : period === 'PM' ? '下午場 🌆' : '全日彙整 📋'
  const dateLabel = date.replace(/-/g, '/')

  const lines: string[] = []
  lines.push(`📋 崧達業務日報 ${dateLabel} ${periodLabel}`)
  lines.push(`${'─'.repeat(28)}`)

  if (visits.length === 0) {
    lines.push('（今日尚無客情紀錄）')
  } else {
    // Group by salesperson
    const byPerson: Record<string, VisitStat[]> = {}
    for (const v of visits) {
      const name = v.salesperson || '（未填）'
      if (!byPerson[name]) byPerson[name] = []
      byPerson[name].push(v)
    }

    for (const [person, pvs] of Object.entries(byPerson)) {
      lines.push(`\n👤 ${person}（${pvs.length} 筆）`)
      for (const v of pvs) {
        const reaction = v.customerReaction ? ` → ${v.customerReaction}` : ''
        const followUp = v.needsFollowUp ? ` ⚠️需追蹤` : ''
        lines.push(`  • ${v.customerName}`)
        if (v.interactionPurpose) lines.push(`    目的：${v.interactionPurpose}${reaction}${followUp}`)
        if (v.followUpAction) lines.push(`    後續：${v.followUpAction}`)
      }
    }
  }

  lines.push(`\n${'─'.repeat(28)}`)

  // Summary
  const totalAmt = todayOrders.reduce((s, o) => s + o.totalAmount, 0)
  lines.push(`📦 今日訂單：${todayOrders.length} 筆${totalAmt > 0 ? ` / NT$${totalAmt.toLocaleString()}` : ''}`)
  lines.push(`⚠️  待追蹤客情：${pendingFollowUps} 件`)
  lines.push(`✅ 客情拜訪：${visits.length} 筆`)

  return lines.join('\n')
}
