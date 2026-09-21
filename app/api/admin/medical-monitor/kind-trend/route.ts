/**
 * GET /api/admin/medical-monitor/kind-trend
 * 近 N 個月（預設 6）各機構類別的新增／減少數量。?refresh=1 才重算（逐月分區查詢，較重）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getMonitorKindTrend } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  const months = Math.min(Math.max(Number(req.nextUrl.searchParams.get('months')) || 6, 1), 13)
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  try {
    const trend = await getMonitorKindTrend(months, { refresh })
    return NextResponse.json(trend)
  } catch (error: any) {
    console.error('kind-trend error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
