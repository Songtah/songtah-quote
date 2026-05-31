/**
 * CEO Dashboard & Daily Report — Notion data layer
 *
 * 效能設計：
 * - visits 改為「每月平行查詢，每月最多 5 頁」取代「全程分頁」
 *   → 6個月 × ~2頁/月，平行執行 ≈ 2–3 秒，取代原本的 21+ 次序列查詢
 * - orders / quotes 筆數少（個位數），直接全撈
 * - 結果快取 30 分鐘
 */
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const ORDERS_DB = process.env.NOTION_ORDERS_DB!
const VISITS_DB = process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16'
const QUOTES_DB = process.env.NOTION_QUOTES_DB!

// ── In-memory cache ─────────────────────────────────────────────
const _cache = new Map<string, { v: unknown; exp: number }>()
function fromCache<T>(key: string): T | null {
  const hit = _cache.get(key)
  return hit && Date.now() < hit.exp ? (hit.v as T) : null
}
function toCache<T>(key: string, v: T, ttlMs: number) {
  _cache.set(key, { v, exp: Date.now() + ttlMs })
}

// ── 安全包裝：單一查詢失敗不拖垮整體 ─────────────────────────────
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) {
    console.warn('[ceo-stats] query failed:', e instanceof Error ? e.message : e)
    return fallback
  }
}

// ── 台北時間日期 helpers ────────────────────────────────────────

export function todayTW(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function tzDate(): Date {
  return new Date(Date.now() + 8 * 3600_000)
}

function monthStart(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 10)
}

function monthEnd(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset + 1)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function monthLabel(offset = 0): string {
  const d = tzDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + offset)
  return d.toISOString().slice(0, 7) // "2026-05"
}

// ── Notion page helpers ─────────────────────────────────────────

function getProp(page: any, field: string) { return page.properties?.[field] }
function getSelect(page: any, f: string): string { return getProp(page, f)?.select?.name ?? '' }
function getText(page: any, f: string): string {
  const p = getProp(page, f)
  if (!p) return ''
  if (p.type === 'rich_text') return p.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  if (p.type === 'title')     return p.title?.map((t: any) => t.plain_text).join('') ?? ''
  return ''
}
function getTitle(page: any, f: string): string {
  const p = getProp(page, f)
  if (!p) return ''
  if (p.type === 'title') return p.title?.map((t: any) => t.plain_text).join('') ?? ''
  return getText(page, f)
}
function getDate(page: any, f: string): string { return getProp(page, f)?.date?.start ?? '' }
function getCheckbox(page: any, f: string): boolean { return getProp(page, f)?.checkbox ?? false }

// ── 通用分頁查詢（有頁數上限，防止無限分頁）───────────────────────
async function queryPaged(
  database_id: string,
  filter?: any,
  sorts?: any[],
  maxPages = 999          // 預設不限，特殊場景傳入限制
): Promise<any[]> {
  const results: any[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const resp: any = await notion.databases.query({
      database_id,
      ...(filter ? { filter } : {}),
      ...(sorts  ? { sorts  } : {}),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any)
    results.push(...(resp.results ?? []))
    cursor = resp.has_more ? resp.next_cursor : undefined
    pages++
  } while (cursor && pages < maxPages)
  return results
}

// ══════════════════════════════════════════════════════════════
// Orders
// ══════════════════════════════════════════════════════════════

export interface OrderStat {
  date: string
  salesperson: string
  status: string
  totalAmount: number
  customerName: string
}

async function fetchOrderStats(from: string, to: string): Promise<OrderStat[]> {
  const pages = await queryPaged(ORDERS_DB, {
    and: [
      { property: '日期', date: { on_or_after: from } },
      { property: '日期', date: { on_or_before: to  } },
    ],
  })
  return pages.map((p) => ({
    date:         getDate(p, '日期'),
    salesperson:  getText(p, '業務'),
    status:       getSelect(p, '狀態'),
    totalAmount:  p.properties?.['總金額']?.number ?? 0,
    customerName: getText(p, '客戶名稱'),
  }))
}

// ══════════════════════════════════════════════════════════════
// Visits
// ══════════════════════════════════════════════════════════════

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

function mapVisitPage(p: any): VisitStat {
  return {
    date:               getDate(p, '日期'),
    salesperson:        getSelect(p, '業務人員') || getText(p, '業務人員'),
    customerName:       getTitle(p, '單位名稱'),
    interactionType:    getSelect(p, '互動類型'),
    interactionPurpose: getSelect(p, '互動目的'),
    customerReaction:   getSelect(p, '客戶反應'),
    followUpAction:     getText(p, '後續動作'),
    needsFollowUp:      getCheckbox(p, '是否需追蹤'),
    nextFollowUpDate:   getDate(p, '下次追蹤日'),
    content:            getText(p, '拜訪內容'),
    city:               p.properties?.['縣市']?.rollup?.array?.[0]?.select?.name
                        ?? getSelect(p, '縣市')
                        ?? getText(p, '縣市'),
  }
}

/**
 * 「當月完整」visits（用於 KPI、業務排行）
 * 本月資料量 ≈ 178 筆 = 2 頁 ≈ 2.2s，可接受
 */
async function fetchVisitsFull(from: string, to: string): Promise<VisitStat[]> {
  const pages = await queryPaged(VISITS_DB, {
    and: [
      { property: '日期', date: { on_or_after: from } },
      { property: '日期', date: { on_or_before: to  } },
    ],
  })
  return pages.map(mapVisitPage)
}

/**
 * 「單月拜訪筆數」（用於 6 個月趨勢圖，只需要數字）
 * 每月查一次，最多 5 頁（500 筆），超過的截斷（圖表用，近似即可）
 * 多個月份用 Promise.all 並行，總耗時 ≈ 單月最慢者 ≈ 2–3s
 */
async function fetchVisitCount(from: string, to: string): Promise<number> {
  const pages = await queryPaged(
    VISITS_DB,
    {
      and: [
        { property: '日期', date: { on_or_after: from } },
        { property: '日期', date: { on_or_before: to  } },
      ],
    },
    undefined,
    5   // 最多 5 頁，500 筆上限
  )
  return pages.length
}

/** 今日拜訪（日報用） */
export async function fetchTodayVisits(date?: string): Promise<VisitStat[]> {
  const d = date ?? todayTW()
  const pages = await queryPaged(VISITS_DB, {
    and: [
      { property: '日期', date: { on_or_after: d } },
      { property: '日期', date: { on_or_before: d } },
    ],
  })
  return pages.map(mapVisitPage)
}

// ══════════════════════════════════════════════════════════════
// Quotes
// ══════════════════════════════════════════════════════════════

export interface QuoteStat {
  date: string
  salesperson: string
  status: string
  total: number
}

async function fetchQuoteStats(from: string, to: string): Promise<QuoteStat[]> {
  const pages = await queryPaged(QUOTES_DB, {
    property: '建立時間',
    created_time: { on_or_after: `${from}T00:00:00Z` },
  })
  // client-side filter to 上限日期（Notion created_time 不支援 on_or_before 在 and 中）
  return pages
    .filter((p: any) => {
      const ct = p.created_time?.slice(0, 10) ?? ''
      return ct >= from && ct <= to
    })
    .map((p: any) => ({
      date:        p.created_time?.slice(0, 10) ?? '',
      salesperson: getText(p, '業務姓名'),
      status:      getSelect(p, '狀態') || '草稿',
      total:       p.properties?.['總金額']?.number ?? 0,
    }))
}

// ══════════════════════════════════════════════════════════════
// CEO Dashboard
// ══════════════════════════════════════════════════════════════

export interface SalespersonStat {
  name: string
  visits: number
  orders: number
  amount: number
  followUps: number
}

export interface MonthlyTrend {
  month:  string   // "2026-05"
  label:  string   // "5月"
  orders: number
  amount: number
  visits: number
  quotes: number
}

export interface CEOStats {
  thisMonth: {
    ordersCount:      number
    ordersAmount:     number
    quotesCount:      number
    visitsCount:      number
    pendingFollowUps: number
  }
  lastMonth: {
    ordersAmount: number
    visitsCount:  number
  }
  salespersonStats:    SalespersonStat[]
  monthlyTrend:        MonthlyTrend[]
  ordersByStatus:      Record<string, number>
  quoteConversionRate: number
  generatedAt:         string
}

export async function getCEOStats(): Promise<CEOStats> {
  const cacheKey = 'ceo-stats:v2'
  const cached = fromCache<CEOStats>(cacheKey)
  if (cached) return cached

  // ── 月份範圍建立 ───────────────────────────────────────────────
  const months = Array.from({ length: 6 }, (_, i) => {
    const offset = i - 5   // -5 → 0（最舊到最新）
    return {
      offset,
      month: monthLabel(offset),
      label: `${parseInt(monthLabel(offset).slice(5))}月`,
      from:  monthStart(offset),
      to:    monthEnd(offset),
    }
  })
  const curMonth = months[5]   // 本月
  const prevMonth = months[4]  // 上月

  // ── 平行查詢策略 ────────────────────────────────────────────────
  // ① orders 6個月（筆數少，快）
  // ② quotes 6個月（筆數少，快）
  // ③ 本月 visits 完整資料（業務排行、KPI 用）
  // ④ 各月 visits 筆數（趨勢圖用，每月最多 5 頁，6 月平行）
  //    → ④ 用 Promise.all 同時發出 6 個查詢，壁鐘時間 ≈ 單月最慢者

  const [allOrders, allQuotes, thisMonthVisits, ...visitCounts] = await Promise.all([
    safe(() => fetchOrderStats(months[0].from, curMonth.to), []),
    safe(() => fetchQuoteStats(months[0].from, curMonth.to), []),
    safe(() => fetchVisitsFull(curMonth.from, curMonth.to), []),
    // 6 個月的 visit count 平行查詢
    ...months.map((m) =>
      safe(() => fetchVisitCount(m.from, m.to), 0)
    ),
  ])

  // ── 上月 visits 筆數（來自 visitCounts[4]）─────────────────────
  const prevMonthVisitCount = visitCounts[4] as number

  // ── 本月篩選 ──────────────────────────────────────────────────
  const thisMonthOrders = (allOrders as OrderStat[]).filter(
    (o) => o.date >= curMonth.from && o.date <= curMonth.to && o.status !== '已取消'
  )
  const thisMonthQuotes = (allQuotes as QuoteStat[]).filter(
    (q) => q.date >= curMonth.from && q.date <= curMonth.to
  )

  // ── 上月篩選 ──────────────────────────────────────────────────
  const lastMonthOrders = (allOrders as OrderStat[]).filter(
    (o) => o.date >= prevMonth.from && o.date <= prevMonth.to && o.status !== '已取消'
  )

  // ── 業務排行（本月）──────────────────────────────────────────
  const spMap: Record<string, SalespersonStat> = {}
  for (const v of thisMonthVisits as VisitStat[]) {
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
  const salespersonStats = Object.values(spMap)
    .sort((a, b) => b.amount - a.amount || b.visits - a.visits)

  // ── 訂單狀態分佈（本月）──────────────────────────────────────
  const ordersByStatus: Record<string, number> = {}
  for (const o of (allOrders as OrderStat[]).filter(
    (o) => o.date >= curMonth.from && o.date <= curMonth.to
  )) {
    ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1
  }

  // ── 趨勢圖 ────────────────────────────────────────────────────
  const monthlyTrend: MonthlyTrend[] = months.map((m, i) => {
    const mOrders = (allOrders as OrderStat[]).filter(
      (o) => o.date >= m.from && o.date <= m.to && o.status !== '已取消'
    )
    const mQuotes = (allQuotes as QuoteStat[]).filter(
      (q) => q.date >= m.from && q.date <= m.to
    )
    return {
      month:  m.month,
      label:  m.label,
      orders: mOrders.length,
      amount: mOrders.reduce((s, o) => s + o.totalAmount, 0),
      visits: visitCounts[i] as number,
      quotes: mQuotes.length,
    }
  })

  // ── 報價轉換率 ────────────────────────────────────────────────
  const sentQuotes = thisMonthQuotes.filter((q) => q.status !== '草稿').length
  const quoteConversionRate = sentQuotes > 0
    ? Math.round((thisMonthOrders.length / sentQuotes) * 100)
    : 0

  // ── 待追蹤（從本月資料計算，不另發 API）──────────────────────
  const pendingFollowUps = (thisMonthVisits as VisitStat[])
    .filter((v) => v.needsFollowUp).length

  const stats: CEOStats = {
    thisMonth: {
      ordersCount:      thisMonthOrders.length,
      ordersAmount:     thisMonthOrders.reduce((s, o) => s + o.totalAmount, 0),
      quotesCount:      thisMonthQuotes.length,
      visitsCount:      visitCounts[5] as number,   // 本月完整 visit count
      pendingFollowUps,
    },
    lastMonth: {
      ordersAmount: lastMonthOrders.reduce((s, o) => s + o.totalAmount, 0),
      visitsCount:  prevMonthVisitCount,
    },
    salespersonStats,
    monthlyTrend,
    ordersByStatus,
    quoteConversionRate,
    generatedAt: new Date().toISOString(),
  }

  toCache(cacheKey, stats, 30 * 60_000) // 快取 30 分鐘
  return stats
}

// ══════════════════════════════════════════════════════════════
// Daily Report
// ══════════════════════════════════════════════════════════════

export interface DailyReportData {
  date: string
  period: 'AM' | 'PM' | 'FULL'
  visits: VisitStat[]
  todayOrders: OrderStat[]
  pendingFollowUps: number
  salespersonNames: string[]   // 該日有記錄的業務姓名清單
}

export async function buildDailyReportData(
  date: string,
  period: 'AM' | 'PM' | 'FULL' = 'FULL',
  salesperson?: string
): Promise<DailyReportData> {
  const [visits, todayOrders] = await Promise.all([
    fetchTodayVisits(date),
    safe(() => fetchOrderStats(date, date), []),
  ])

  let filteredVisits = visits as VisitStat[]

  // 依業務姓名篩選
  if (salesperson) {
    filteredVisits = filteredVisits.filter((v) => v.salesperson === salesperson)
  }

  // 依時段篩選
  if (period === 'AM') {
    filteredVisits = filteredVisits.slice(0, Math.ceil(filteredVisits.length / 2))
  }

  const pendingFollowUps = filteredVisits.filter((v) => v.needsFollowUp).length

  // 回傳該日所有業務姓名（供前端下拉選單使用）
  const allNames = (visits as VisitStat[]).map((v) => v.salesperson).filter(Boolean)
  const seen = new Set<string>()
  const salespersonNames: string[] = []
  for (const n of allNames) { if (!seen.has(n)) { seen.add(n); salespersonNames.push(n) } }

  return {
    date,
    period,
    visits: filteredVisits,
    todayOrders: (todayOrders as OrderStat[]).filter((o) => o.status !== '已取消'),
    pendingFollowUps,
    salespersonNames,
  }
}

/** 格式化日報文字 */
export function formatDailyReport(data: DailyReportData): string {
  const { date, period, visits, todayOrders, pendingFollowUps } = data

  const periodLabel =
    period === 'AM' ? '上午場 ☀️' : period === 'PM' ? '下午場 🌆' : '全日彙整 📋'
  const dateLabel = date.replace(/-/g, '/')

  const lines: string[] = []
  lines.push(`📋 崧達業務日報 ${dateLabel} ${periodLabel}`)
  lines.push('─'.repeat(28))

  if (visits.length === 0) {
    lines.push('（今日尚無客情紀錄）')
  } else {
    const byPerson: Record<string, VisitStat[]> = {}
    for (const v of visits) {
      const name = v.salesperson || '（未填）'
      if (!byPerson[name]) byPerson[name] = []
      byPerson[name].push(v)
    }
    for (const [person, pvs] of Object.entries(byPerson)) {
      lines.push(`\n👤 ${person}（${pvs.length} 筆）`)
      for (const v of pvs) {
        const reaction  = v.customerReaction   ? ` → ${v.customerReaction}`   : ''
        const followUp  = v.needsFollowUp      ? ' ⚠️需追蹤'                  : ''
        lines.push(`  • ${v.customerName}`)
        if (v.interactionPurpose) lines.push(`    目的：${v.interactionPurpose}${reaction}${followUp}`)
        if (v.followUpAction)     lines.push(`    後續：${v.followUpAction}`)
      }
    }
  }

  lines.push(`\n${'─'.repeat(28)}`)
  const totalAmt = todayOrders.reduce((s, o) => s + o.totalAmount, 0)
  lines.push(`📦 今日訂單：${todayOrders.length} 筆${totalAmt > 0 ? ` / NT$${totalAmt.toLocaleString()}` : ''}`)
  lines.push(`⚠️  待追蹤客情：${pendingFollowUps} 件`)
  lines.push(`✅ 客情拜訪：${visits.length} 筆`)

  return lines.join('\n')
}
