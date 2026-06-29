import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteVisit, getVisitById, updateVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { canEdit } from '@/lib/permissions'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'crm')) {
    return NextResponse.json({ error: '無編輯客情紀錄權限' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const before = await getVisitById(params.id).catch(() => null)
    const updateData = { ...body }
    if (body.tags !== undefined && !Array.isArray(body.tags)) delete updateData.tags
    if (body.competitorEquipment !== undefined && !Array.isArray(body.competitorEquipment)) delete updateData.competitorEquipment
    if (body.interestedProductIds !== undefined && !Array.isArray(body.interestedProductIds)) delete updateData.interestedProductIds
    if (body.needsFollowUp !== undefined && typeof body.needsFollowUp !== 'boolean') delete updateData.needsFollowUp
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
  } catch (error: any) {
    console.error('updateVisit error:', error)
    // 把 Notion 的原始錯誤訊息也回傳，方便前端顯示更精確的原因
    const detail = error?.body?.message ?? error?.message ?? ''
    return NextResponse.json(
      { error: `更新客情紀錄失敗${detail ? `：${detail}` : ''}` },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'crm')) {
    return NextResponse.json({ error: '無刪除客情紀錄權限' }, { status: 403 })
  }

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
