import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { deleteVisit, getVisitById, updateVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

function canManageVisit(session: any, salesperson?: string) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理' || Boolean(user?.name && salesperson === user.name)
}

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const body = await req.json()
    const before = await getVisitById(params.id).catch(() => null)
    if (!before) return NextResponse.json({ error: '找不到客情紀錄' }, { status: 404 })
    if (!canManageVisit(session, before.salesperson)) {
      return NextResponse.json({ error: '不可修改其他業務的客情紀錄' }, { status: 403 })
    }
    const updateData = { ...body }
    const user = session.user as any
    if (user?.role !== 'admin' && user?.accountType !== '中央管理') delete updateData.salesperson
    if (body.tags !== undefined && !Array.isArray(body.tags)) delete updateData.tags
    if (body.competitorEquipment !== undefined && !Array.isArray(body.competitorEquipment)) delete updateData.competitorEquipment
    if (body.interestedProductIds !== undefined && !Array.isArray(body.interestedProductIds)) delete updateData.interestedProductIds
    if (body.needsFollowUp !== undefined && typeof body.needsFollowUp !== 'boolean') delete updateData.needsFollowUp
    await updateVisit(params.id, updateData)

    const after = await getVisitById(params.id).catch(() => ({ id: params.id, ...body }))
    await logAuditEvent({
      module: 'bd',
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
})

export const DELETE = withApiAuth({ module: 'bd', action: 'edit' }, async (_req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const before = await getVisitById(params.id).catch(() => null)
    if (!before) return NextResponse.json({ error: '找不到客情紀錄' }, { status: 404 })
    if (!canManageVisit(session, before.salesperson)) {
      return NextResponse.json({ error: '不可刪除其他業務的客情紀錄' }, { status: 403 })
    }
    await deleteVisit(params.id)

    await logAuditEvent({
      module: 'bd',
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
})
