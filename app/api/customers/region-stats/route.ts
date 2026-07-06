/**
 * GET /api/customers/region-stats — 區域客戶儀表板資料源
 *
 * 回傳全客戶庫以 (縣市, 行政區, 類型, 機構狀態, 負責業務, 開發階段) 分組的計數列,
 * 前端自由交叉篩選。Redis 快取 1 小時;?refresh=1 強制重掃。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getRegionStatsRows } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
    const data = await getRegionStatsRows(forceRefresh)
    return NextResponse.json(data)
  } catch (error) {
    console.error('region-stats error:', error)
    return NextResponse.json({ error: '讀取區域統計失敗' }, { status: 500 })
  }
})
