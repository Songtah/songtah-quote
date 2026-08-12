/**
 * GET /api/dashboard/my-performance
 *
 * 業務個人業績摘要。只回傳呼叫者自己的數字——不揭露其他業務的具體金額
 * (已與使用者確認的隱私政策：業務個人儀表板只顯示自己金額＋名次)。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCEOStats } from '@/lib/ceo-stats'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (_req, _ctx, session) => {
  try {
    const userName = session.user?.name?.trim() ?? ''
    if (!userName) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const stats = await getCEOStats()
    const rankedIndex = stats.salespersonStats.findIndex((s) => s.name === userName)
    const summary = rankedIndex >= 0 ? stats.salespersonStats[rankedIndex] : null
    const trend = stats.salespersonMonthlyTrend[userName] ?? []
    // 上月比較用自己的走勢(倒數第二個月),不讀公司總金額——避免業務藉此反推其他同事的數字。
    const lastMonthAmount = trend.length >= 2 ? trend[trend.length - 2].amount : 0

    return NextResponse.json({
      summary: summary && {
        amount: summary.amount,
        orders: summary.orders,
        visits: summary.visits,
        followUps: summary.followUps,
      },
      rank: rankedIndex >= 0 ? rankedIndex + 1 : null,
      totalSalespeople: stats.salespersonStats.length,
      lastMonthAmount,
      trend,
      generatedAt: stats.generatedAt,
    })
  } catch (error) {
    console.error('my-performance GET error:', error)
    return NextResponse.json({ error: '讀取業績資料失敗' }, { status: 500 })
  }
})
