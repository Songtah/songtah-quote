import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listVisits, createVisit } from '@/lib/system-notion'
import { applyAutoClaimForVisit } from '@/lib/notion/visit-claim'
import { bumpContactedByCustomer } from '@/lib/notion/campaigns'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { advanceCustomerDevStage } from '@/lib/notion/customers'

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const p = req.nextUrl.searchParams
    const customerName = p.get('customerName') ?? undefined
    const user = session.user as any
    const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理'
    // 一般帳號只能讀取自己的客情。不可相信 client 傳入的 salesperson，
    // 否則只要改 query string 就能跨業務列舉機密紀錄。
    const salesperson = canViewAll
      ? p.get('salesperson') ?? undefined
      : session.user?.name || '__NO_MATCH__'
    const cursor       = p.get('cursor')        ?? undefined
    const limit        = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)

    const result = await listVisits({ customerName, salesperson, cursor, limit })
    return NextResponse.json(result)
  } catch (error) {
    console.error('listVisits error:', error)
    return NextResponse.json({ error: '讀取客情紀錄失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const {
      customerName, date, salesperson, status, content, address, city, district, customerId,
      tags, competitorEquipment, interestedProductIds,
      interactionType, interactionPurpose, customerReaction, followUpAction, needsFollowUp, nextFollowUpDate,
    } = body

    if (!customerName) return NextResponse.json({ error: '客戶名稱必填' }, { status: 400 })

    const user = session.user as any
    const canCreateForOthers = user?.role === 'admin' || user?.accountType === '中央管理'
    const scopedSalesperson = canCreateForOthers ? salesperson : session.user?.name

    const visit = await createVisit({
      customerName,
      date,
      salesperson: scopedSalesperson,
      status,
      content,
      address,
      city,
      district,
      customerId,
      tags: Array.isArray(tags) ? tags : [],
      competitorEquipment: Array.isArray(competitorEquipment) ? competitorEquipment : [],
      interestedProductIds: Array.isArray(interestedProductIds) ? interestedProductIds : [],
      interactionType: interactionType ?? '',
      interactionPurpose: interactionPurpose ?? '',
      customerReaction: customerReaction ?? '',
      followUpAction: followUpAction ?? '',
      needsFollowUp: typeof needsFollowUp === 'boolean' ? needsFollowUp : false,
      nextFollowUpDate: nextFollowUpDate ?? '',
    })

    // 第一層自動認領:轄區內且無人負責才寫,其餘留給「待認領建議」由人確認。
    // 這裡的客戶是使用者從選單挑的,比對確定,故 unambiguous=true。
    let autoClaim: { claimed: boolean; reason: string } = { claimed: false, reason: 'no-customer' }
    if (customerId && scopedSalesperson) {
      autoClaim = await applyAutoClaimForVisit({
        salesperson: scopedSalesperson, customerId, unambiguous: true,
      })
    }

    // 追蹤名單連動:此客戶在進行中名單裡的「未聯絡」→「已聯絡」(fire-and-forget,不影響建檔)
    if (customerId) {
      bumpContactedByCustomer(customerId).catch((e) => console.warn('campaign bump error:', e))
      const targetStage = customerReaction === '同意試用' ? '試用中' : '已接觸'
      await advanceCustomerDevStage(customerId, targetStage, {
        actorName: session.user?.name ?? '',
        canManageAll: canCreateForOthers,
      }).catch((e) =>
        console.warn('visit stage advance error:', e)
      )
    }

    await logAuditEvent({
      module: 'bd',
      action: 'create',
      entityType: 'visit',
      entityId: visit.id,
      entityTitle: visit.customerName,
      summary: `新增客情紀錄：${visit.customerName}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: { ...visit, autoClaimed: autoClaim.claimed, autoClaimReason: autoClaim.reason },
    }).catch((error) => console.error('audit createVisit error:', error))

    return NextResponse.json({ ...visit, autoClaim }, { status: 201 })
  } catch (error) {
    console.error('createVisit error:', error)
    return NextResponse.json({ error: '建立客情紀錄失敗' }, { status: 500 })
  }
})
