import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteVisit, getVisitById, updateVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    const before = await getVisitById(params.id).catch(() => null)
    const updateData = { ...body }
    if (body.tags !== undefined && !Array.isArray(body.tags)) delete updateData.tags
    if (body.competitorEquipment !== undefined && !Array.isArray(body.competitorEquipment)) delete updateData.competitorEquipment
    await updateVisit(params.id, updateData)

    const after = await getVisitById(params.id).catch(() => ({ id: params.id, ...body }))
    await logAuditEvent({
      module: 'crm',
      action: 'update',
      entityType: 'visit',
      entityId: params.id,
      entityTitle: after?.customerName ?? before?.customerName ?? '',
      summary: `更新客情紀錄：${after?.customerName ?? before?.customerName ?? params.id}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
      after,
      metadata: { changedFields: Object.keys(body ?? {}) },
    }).catch((error) => console.error('audit updateVisit error:', error))

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('updateVisit error:', error)
    return NextResponse.json({ error: '更新客情紀錄失敗' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const before = await getVisitById(params.id).catch(() => null)
    await deleteVisit(params.id)

    await logAuditEvent({
      module: 'crm',
      action: 'delete',
      entityType: 'visit',
      entityId: params.id,
      entityTitle: before?.customerName ?? '',
      summary: `刪除客情紀錄：${before?.customerName ?? params.id}`,
      actor: getAuditActor(session),
      before,
    }).catch((error) => console.error('audit deleteVisit error:', error))

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('deleteVisit error:', error)
    return NextResponse.json({ error: '刪除客情紀錄失敗' }, { status: 500 })
  }
}
