/**
 * GET /api/products/prices/announcements —— 價格異動公告（所有登入者可看）
 * 中央管理另外拿到「本月目前為止的調價紀錄」（下個月 1 日會變成公告的內容）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { isCentralManagement } from '@/lib/permissions'
import { collapseChanges, countChanges, currentPeriodTW, listAnnouncements, listPriceChanges, monthRangeTW } from '@/lib/product-pricing'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (_req: NextRequest, _ctx, session) => {
  try {
    const announcements = await listAnnouncements()
    let pending = null
    if (isCentralManagement(session)) {
      const period = currentPeriodTW()
      const { from, to } = monthRangeTW(period)
      const rows = collapseChanges(await listPriceChanges(from, to)).sort((a, b) => b.at - a.at)
      pending = { period, counts: countChanges(rows), rows }
    }
    return NextResponse.json({ announcements, pending }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '價格公告暫時無法讀取' }, { status: 503 })
  }
})
