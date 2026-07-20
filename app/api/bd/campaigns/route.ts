/**
 * /api/bd/campaigns — 追蹤名單
 * GET  → 名單清單,每張附成員進度統計(組合層:campaigns × members 彙總)
 * POST → 建立名單 { name, product, targetSkus?, deadline?, note? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCampaigns, listMembers, createCampaign, MEMBER_STATUSES } from '@/lib/notion/campaigns'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

function canViewAll(session: any) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理'
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req, _ctx, session) => {
  try {
    const campaigns = await listCampaigns()
    // 每張名單的成員狀態統計(名單數少,逐張查可接受;>20 張時再優化)
    const items = await Promise.all(campaigns.map(async (c) => {
      const allMembers = await listMembers(c.id)
      const members = canViewAll(session)
        ? allMembers
        : allMembers.filter((member) => member.salesperson === session.user?.name)
      const byStatus: Record<string, number> = {}
      for (const s of MEMBER_STATUSES) byStatus[s] = 0
      for (const m of members) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1
      return { ...c, memberCount: members.length, byStatus }
    }))
    return NextResponse.json({ items })
  } catch (error) {
    console.error('campaigns GET error:', error)
    return NextResponse.json({ error: '讀取追蹤名單失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const name = (body.name ?? '').trim()
    const product = (body.product ?? '').trim()
    if (!name || !product) return NextResponse.json({ error: '名單名稱與目標商品必填' }, { status: 400 })

    const campaign = await createCampaign({
      name, product,
      targetSkus: Array.isArray(body.targetSkus) ? body.targetSkus : undefined,
      deadline: body.deadline || undefined,
      note: body.note || undefined,
      creator: session.user?.name ?? '',
    })

    await logAuditEvent({
      module: 'bd', action: 'create', entityType: 'campaign',
      entityId: campaign.id, entityTitle: name,
      summary: `建立追蹤名單:${name}(${product})`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: body,
    }).catch(() => {})

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('campaigns POST error:', error)
    return NextResponse.json({ error: '建立名單失敗' }, { status: 500 })
  }
})
