/**
 * GET /api/bd/tenders — 牙科相關政府標案（讀每日排程算好的快照）
 * ?refresh=1 重抓（很重、會打外部 API，限中央管理）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getTenders, refreshTenders, rebuildSnapshot } from '@/lib/notion/tenders'
import { updateTenderTrack, TENDER_STATUSES, type TenderStatus } from '@/lib/notion/tenders-db'
import { advanceCustomerDevStage } from '@/lib/notion/customers'

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
    return NextResponse.json({ ...(snapshot ?? { records: [], computedAt: '' }), ready: Boolean(snapshot) })
  } catch (error: any) {
    console.error('tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})

/**
 * POST /api/bd/tenders — 追蹤狀態（認領、標狀態、備註）
 * body: { tenderId, status?, owner?, note?, customerId? }
 * 權限：bd edit。owner 傳 null＝取消認領；不傳 owner 則沿用原值。
 */
export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json().catch(() => ({}))
    const pageId = String(body.pageId ?? '')
    if (!pageId) return NextResponse.json({ error: '缺少 pageId' }, { status: 400 })
    const status = body.status ? String(body.status) as TenderStatus : undefined
    if (status && !TENDER_STATUSES.includes(status)) {
      return NextResponse.json({ error: `狀態須為：${TENDER_STATUSES.join('／')}` }, { status: 400 })
    }
    const actor = session?.user?.name ?? '未知'
    await updateTenderTrack(pageId, {
      status,
      owner: body.owner === null ? null : (body.owner === undefined ? undefined : String(body.owner)),
      note: body.note === undefined ? undefined : String(body.note).slice(0, 300),
    })
    // 投標＝正在報價：機關是既有客戶時把開發階段推到「報價中」（成交仍以訂單為準）
    if (status === '投標中' && body.customerId) {
      await advanceCustomerDevStage(String(body.customerId), '報價中', { actorName: actor, canManageAll: false })
        .catch(() => false)
    }
    await rebuildSnapshot().catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('tender track error:', error)
    return NextResponse.json({ error: error?.message ?? '更新失敗' }, { status: 500 })
  }
})
