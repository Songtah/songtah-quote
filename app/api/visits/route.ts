import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listVisits, createVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const p = req.nextUrl.searchParams
    const customerName = p.get('customerName') ?? undefined
    const salesperson  = p.get('salesperson')  ?? undefined
    const cursor       = p.get('cursor')        ?? undefined
    const limit        = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)

    const result = await listVisits({ customerName, salesperson, cursor, limit })
    return NextResponse.json(result)
  } catch (error) {
    console.error('listVisits error:', error)
    return NextResponse.json({ error: '讀取客情紀錄失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth({ module: 'crm', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const {
      customerName, date, salesperson, status, content, address, city, district, customerId,
      tags, competitorEquipment, interestedProductIds,
      interactionType, interactionPurpose, customerReaction, followUpAction, needsFollowUp, nextFollowUpDate,
    } = body

    if (!customerName) return NextResponse.json({ error: '客戶名稱必填' }, { status: 400 })

    const visit = await createVisit({
      customerName,
      date,
      salesperson,
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

    await logAuditEvent({
      module: 'bd',
      action: 'create',
      entityType: 'visit',
      entityId: visit.id,
      entityTitle: visit.customerName,
      summary: `新增客情紀錄：${visit.customerName}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: visit,
    }).catch((error) => console.error('audit createVisit error:', error))

    return NextResponse.json(visit, { status: 201 })
  } catch (error) {
    console.error('createVisit error:', error)
    return NextResponse.json({ error: '建立客情紀錄失敗' }, { status: 500 })
  }
})
