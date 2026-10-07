/**
 * GET /api/admin/medical-monitor/kind-trend
 * 近 N 個月（預設 6）各機構類別的新增／減少數量＋逐筆名單（點長條直接用，不再另外查）。
 * 讀存好的結果；?refresh=1 才重算（「重新計算」按鈕；每晚另由 /api/cron/refresh-kind-trend 重算）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getKindTrend } from '@/lib/medical-monitor-trend'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // 重算含客戶主檔比對，冷快取時需全掃

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  const months = Math.min(Math.max(Number(req.nextUrl.searchParams.get('months')) || 6, 1), 13)
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  try {
    const trend = await getKindTrend({ months, refresh })
    return NextResponse.json(trend)
  } catch (error: any) {
    console.error('kind-trend error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
