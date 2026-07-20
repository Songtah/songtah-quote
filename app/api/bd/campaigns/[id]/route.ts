/**
 * /api/bd/campaigns/[id] — 單一名單
 * GET   → 名單詳情+成員清單(成員附客戶電話/地址,組合 customers 領域)
 * PATCH → { memberId, status?, note? } 更新成員;或 { campaignStatus } 結束/重啟名單
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCampaigns, listMembers, updateMember, updateCampaignStatus } from '@/lib/notion/campaigns'
import { getSystemCustomerById } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function canViewAll(session: any) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理'
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const campaigns = await listCampaigns()
    const campaign = campaigns.find((c) => c.id === params.id || c.id.replace(/-/g, '') === params.id.replace(/-/g, ''))
    if (!campaign) return NextResponse.json({ error: '找不到名單' }, { status: 404 })

    const allMembers = await listMembers(campaign.id)
    const members = canViewAll(session)
      ? allMembers
      : allMembers.filter((member) => member.salesperson === session.user?.name)
    // 補客戶電話/地址(併發限流:一次 5 個)
    const enriched: any[] = []
    for (let i = 0; i < members.length; i += 5) {
      const batch = await Promise.all(members.slice(i, i + 5).map(async (m) => {
        const cust = m.customerId ? await getSystemCustomerById(m.customerId) : null
        return { ...m, phone: cust?.phone ?? '', address: cust?.address ?? '', city: cust?.city ?? '', district: cust?.district ?? '', type: cust?.type ?? '' }
      }))
      enriched.push(...batch)
    }
    return NextResponse.json({ campaign, members: enriched })
  } catch (error) {
    console.error('campaign GET error:', error)
    return NextResponse.json({ error: '讀取名單失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const body = await req.json()

    if (body.campaignStatus) {
      if (!canViewAll(session)) return NextResponse.json({ error: '只有中央管理可以變更整份名單狀態' }, { status: 403 })
      if (!['進行中', '已結束'].includes(body.campaignStatus)) {
        return NextResponse.json({ error: '無效的名單狀態' }, { status: 400 })
      }
      await updateCampaignStatus(params.id, body.campaignStatus)
      return NextResponse.json({ ok: true })
    }

    const { memberId, status, note } = body
    if (!memberId) return NextResponse.json({ error: '缺少 memberId' }, { status: 400 })
    if (!canViewAll(session)) {
      const members = await listMembers(params.id)
      const member = members.find((item) => item.id === memberId || item.id.replace(/-/g, '') === String(memberId).replace(/-/g, ''))
      if (!member || member.salesperson !== session.user?.name) {
        return NextResponse.json({ error: '不可更新其他業務的追蹤對象' }, { status: 403 })
      }
    }
    await updateMember(memberId, { status, note })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const msg = typeof error?.message === 'string' ? error.message : ''
    const isValidation = msg.includes('無效的成員狀態')
    console.error('campaign PATCH error:', error)
    return NextResponse.json({ error: isValidation ? msg : '更新失敗' }, { status: isValidation ? 400 : 500 })
  }
})
