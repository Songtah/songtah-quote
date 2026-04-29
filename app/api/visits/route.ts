import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listVisits, createVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const customerName = req.nextUrl.searchParams.get('customerName') ?? undefined
    const visits = await listVisits(customerName ? { customerName } : undefined)
    return NextResponse.json(visits)
  } catch (error) {
    console.error('listVisits error:', error)
    return NextResponse.json({ error: '讀取客情紀錄失敗' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    const { customerName, date, salesperson, status, content, address, city, district, customerId, tags, competitorEquipment, interestedProductIds } = body

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
}
