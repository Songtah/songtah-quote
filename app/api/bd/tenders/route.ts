/**
 * GET /api/bd/tenders — 牙科相關政府標案（讀每日排程算好的快照）
 * ?refresh=1 重抓（很重、會打外部 API，限中央管理）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getTenders, refreshTenders } from '@/lib/notion/tenders'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    if (refresh) {
      const user = session?.user as any
      const canRefresh = user?.role === 'admin' || user?.accountType === '中央管理'
      if (!canRefresh) return NextResponse.json({ error: '只有中央管理可以重抓' }, { status: 403 })
      return NextResponse.json(await refreshTenders())
    }
    const snapshot = await getTenders()
    return NextResponse.json(snapshot ?? { records: [], stats: {}, computedAt: '', days: 0, ready: false })
  } catch (error: any) {
    console.error('tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
