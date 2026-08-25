/**
 * GET /api/dashboard/my-performance/period?period=week|month|quarter|year
 *
 * 業務個人業績：指定期間的統計總數 ＋ 訂單明細 ＋ 與對照期比較。
 *
 * 隱私：沿用 /api/dashboard/my-performance 的政策——只回傳呼叫者本人的數字，
 * 不揭露其他業務的金額。中央管理／總經理可用 ?salesperson= 指定對象。
 *
 * 為什麼不擴充既有的 my-performance：那支讀 getCEOStats()（快取 30 分鐘、
 * 固定近 6 個月視窗），適合首頁摘要；這裡要任意期間（含跨年）與逐筆明細，
 * 直接查訂單庫比較單純，也不會為了個人查詢去撐大全公司統計的快取。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOrdersBySalesperson, listOrdersByDateRange } from '@/lib/orders-notion'
import { listVisitTallies } from '@/lib/notion/visits'
import { getSystemUsers } from '@/lib/notion/accounts'
import { INACTIVE_SALESPERSONS, resolveSalesperson } from '@/lib/line-salesperson-map'
import { parsePeriod, resolvePeriod, PERIOD_LABEL, PREVIOUS_PERIOD_LABEL, ALL_SALESPEOPLE } from '@/lib/performance-periods'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** 已取消的訂單不計入業績 */
const EXCLUDED_ORDER_STATUS = new Set(['已取消'])

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase('zh-TW') === b.trim().toLocaleLowerCase('zh-TW')
}

export const GET = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  try {
    const user = session.user as any
    const canViewOthers = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''
    // 管理帳號不指定對象時看全體；一般業務永遠只看自己（忽略 salesperson 參數）
    const teamMode = canViewOthers && (requested === '' || requested === ALL_SALESPEOPLE)
    const owner = teamMode ? '' : (canViewOthers && requested ? requested : (session.user?.name?.trim() ?? ''))
    if (!teamMode && !owner) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const period = parsePeriod(req.nextUrl.searchParams.get('period'))
    const range = resolvePeriod(period)

    // 一次撈「對照期起 ~ 本期迄」，本期與對照期在記憶體切分，省一輪查詢
    const [orders, visitResult] = await Promise.all([
      (teamMode
        ? listOrdersByDateRange(range.prevFrom, range.to)
        : listOrdersBySalesperson(owner, { from: range.prevFrom, to: range.to })
      ).catch((error) => { console.error('my-performance/period: 訂單讀取失敗', error); return [] }),
      listVisitTallies(range.prevFrom, range.to, teamMode ? undefined : owner)
        .catch((error) => { console.error('my-performance/period: 拜訪讀取失敗', error); return [] }),
    ])

    const mine = orders.filter((o) => !EXCLUDED_ORDER_STATUS.has(o.status))
    const inRange = (date: string, from: string, to: string) => date >= from && date <= to

    const current = mine.filter((o) => inRange(o.date, range.from, range.to))
    const previous = mine.filter((o) => inRange(o.date, range.prevFrom, range.prevTo))
    const myVisits = teamMode ? visitResult : visitResult.filter((v) => sameName(v.salesperson, owner))
    const currentVisits = myVisits.filter((v) => inRange(v.date, range.from, range.to))
    const previousVisits = myVisits.filter((v) => inRange(v.date, range.prevFrom, range.prevTo))

    const sum = (rows: typeof current) => rows.reduce((total, o) => total + o.totalAmount, 0)
    const amount = sum(current)
    const prevAmount = sum(previous)

    // 訂單狀態分佈：讓業務知道金額裡有多少還沒真正到貨
    const byStatus: Record<string, { orders: number; amount: number }> = {}
    for (const order of current) {
      const entry = byStatus[order.status] ?? { orders: 0, amount: 0 }
      entry.orders++
      entry.amount += order.totalAmount
      byStatus[order.status] = entry
    }

    // 團隊模式：各業務排行（金額高到低）。離職業務先正規化姓名再排除，
    // 因為訂單/客情的「業務」欄位可能還留著舊的 LINE 顯示名稱。
    let bySalesperson: { name: string; amount: number; orders: number; visits: number }[] = []
    let salespeople: string[] = []
    if (teamMode) {
      const agg = new Map<string, { name: string; amount: number; orders: number; visits: number }>()
      const bump = (rawName: string, patch: Partial<{ amount: number; orders: number; visits: number }>) => {
        const name = (rawName ?? '').trim() || '（未填）'
        if (INACTIVE_SALESPERSONS.has(resolveSalesperson(name))) return
        const entry = agg.get(name) ?? { name, amount: 0, orders: 0, visits: 0 }
        entry.amount += patch.amount ?? 0
        entry.orders += patch.orders ?? 0
        entry.visits += patch.visits ?? 0
        agg.set(name, entry)
      }
      for (const order of current) bump(order.salesperson, { amount: order.totalAmount, orders: 1 })
      for (const visit of currentVisits) bump(visit.salesperson, { visits: 1 })
      bySalesperson = Array.from(agg.values()).sort((a, b) => b.amount - a.amount || b.visits - a.visits)

      // 下拉選單用：現職業務帳號 ∪ 本期實際有紀錄者
      const accounts = await getSystemUsers().catch(() => [])
      const active = accounts
        .filter((a) => a.accountType === '業務' && a.status !== '停用')
        .map((a) => a.name)
      salespeople = Array.from(new Set([...active, ...bySalesperson.map((s) => s.name)]))
        .filter((name) => name !== '（未填）' && !INACTIVE_SALESPERSONS.has(resolveSalesperson(name)))
        .sort((a, b) => a.localeCompare(b, 'zh-TW'))
    }

    return NextResponse.json({
      scope: teamMode ? 'team' : 'self',
      salesperson: teamMode ? '全部業務' : owner,
      bySalesperson,
      salespeople,
      period,
      periodLabel: PERIOD_LABEL[period],
      previousLabel: PREVIOUS_PERIOD_LABEL[period],
      range: { from: range.from, to: range.to, label: range.label },
      previousRange: { from: range.prevFrom, to: range.prevTo },
      summary: {
        amount,
        orders: current.length,
        visits: currentVisits.length,
        averageOrderAmount: current.length > 0 ? Math.round(amount / current.length) : 0,
      },
      previous: {
        amount: prevAmount,
        orders: previous.length,
        visits: previousVisits.length,
      },
      // 成長率：對照期為 0 時不給百分比（避免顯示 Infinity），由前端顯示「—」
      growth: {
        amountPct: prevAmount > 0 ? Math.round(((amount - prevAmount) / prevAmount) * 100) : null,
        amountDelta: amount - prevAmount,
        ordersDelta: current.length - previous.length,
        visitsDelta: currentVisits.length - previousVisits.length,
      },
      byStatus,
      // 明細依日期新到舊；上限 200 筆避免年度區間回傳過大
      items: current
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 200)
        .map((o) => ({
          date: o.date,
          customerName: o.customerName,
          status: o.status,
          amount: o.totalAmount,
          orderNumber: o.orderNumber,
        })),
      itemsTruncated: current.length > 200,
    })
  } catch (error) {
    console.error('my-performance/period GET error:', error)
    return NextResponse.json({ error: '讀取業績資料失敗' }, { status: 500 })
  }
})
