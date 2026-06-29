/**
 * GET /api/admin/medical-monitor/changes?month=YYYY-MM
 * 本月異動：讀「診所監控紀錄」DB 該月的新開業/新增停業/停業/恢復開業。
 * 需兩個月 BAS 快照才有資料（月排程比對產生）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getMonthlyMonitorChanges } from '@/lib/system-notion'

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  const month = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)
  const changes = await getMonthlyMonitorChanges(month)
  return NextResponse.json({ month, changes })
})
