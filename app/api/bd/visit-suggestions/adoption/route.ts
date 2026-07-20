/**
 * /api/bd/visit-suggestions/adoption — 拜訪建議採納率(可追溯)
 *
 * POST → 記錄一次「複製拜訪單」事件(客戶清單+分組),存 Redis,不動 Notion schema。
 * GET  → 算採納率:複製建議後,該客戶是否在複製日之後真的有拜訪紀錄(比對 scanVisitRecency)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { logSuggestionCopy, getSuggestionAdoptionStats } from '@/lib/notion/visit-suggestions'

export const dynamic = 'force-dynamic'

function canViewAll(session: any) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理'
}

export const POST = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const { city, district, items } = body ?? {}
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '缺少建議清單' }, { status: 400 })
    }
    const salesperson = (session?.user?.name as string) ?? ''
    const customerIds: string[] = []
    const groups: Record<string, 'A' | 'B' | 'C'> = {}
    for (const it of items) {
      if (!it?.id || !it?.group) continue
      customerIds.push(it.id)
      groups[it.id] = it.group
    }
    await logSuggestionCopy({ salesperson, city: city ?? '', district: district ?? '', customerIds, groups })
    return NextResponse.json({ ok: true, logged: customerIds.length })
  } catch (error) {
    console.error('visit-suggestions/adoption POST error:', error)
    return NextResponse.json({ error: '記錄失敗' }, { status: 500 })
  }
})

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const sp = req.nextUrl.searchParams
    const mine = !canViewAll(session) || sp.get('mine') === '1'
    const salesperson = mine ? (session?.user?.name as string) ?? undefined : undefined
    const sinceDays = Math.min(180, Math.max(1, Number(sp.get('days')) || 30))
    const stats = await getSuggestionAdoptionStats({ salesperson, sinceDays })
    return NextResponse.json(stats)
  } catch (error) {
    console.error('visit-suggestions/adoption GET error:', error)
    return NextResponse.json({ error: '讀取採納率失敗' }, { status: 500 })
  }
})
