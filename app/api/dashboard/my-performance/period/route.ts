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
import { listOrdersBySalesperson } from '@/lib/orders-notion'
import { listVisits } from '@/lib/notion/visits'
import { parsePeriod, resolvePeriod, PERIOD_LABEL, PREVIOUS_PERIOD_LABEL } from '@/lib/performance-periods'

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
    const owner = canViewOthers && requested ? requested : (session.user?.name?.trim() ?? '')
    if (!owner) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const period = parsePeriod(req.nextUrl.searchParams.get('period'))
    const range = resolvePeriod(period)

    // 一次撈「對照期起 ~ 本期迄」，本期與對照期在記憶體切分，省一輪查詢
    const [orders, visitResult] = await Promise.all([
      listOrdersBySalesperson(owner, { from: range.prevFrom, to: range.to })
        .catch((error) => { console.error('my-performance/period: 訂單讀取失敗', error); return [] }),
      listVisits({ salesperson: owner, dateFrom: range.prevFrom, dateTo: range.to, fetchAll: true })
        .then((r) => r.items)
        .catch((error) => { console.error('my-performance/period: 拜訪讀取失敗', error); return [] }),
    ])

    const mine = orders.filter((o) => !EXCLUDED_ORDER_STATUS.has(o.status))
    const inRange = (date: string, from: string, to: string) => date >= from && date <= to

    const current = mine.filter((o) => inRange(o.date, range.from, range.to))
    const previous = mine.filter((o) => inRange(o.date, range.prevFrom, range.prevTo))
    const myVisits = visitResult.filter((v) => sameName(v.salesperson, owner))
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

    return NextResponse.json({
      salesperson: owner,
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
