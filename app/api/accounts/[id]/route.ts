import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  BUSINESS_ASSIGNMENT_MODES, updateSystemUser, deleteSystemUser, getSystemUserById,
  type BusinessAssignmentMode,
} from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const PATCH = withApiAuth('admin', async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const body = await req.json()
    if (body.assignmentMode !== undefined && !BUSINESS_ASSIGNMENT_MODES.includes(body.assignmentMode as BusinessAssignmentMode)) {
      return NextResponse.json({ error: '無效的業務承接模式' }, { status: 400 })
    }
    const before = await getSystemUserById(params.id).catch(() => null)
    await updateSystemUser(params.id, {
      name: body.name,
      password: body.password || undefined,
      accountType: body.accountType,
      status: body.status,
      assignmentMode: body.accountType && body.accountType !== '業務' ? '全面開發' : body.assignmentMode,
      permissions: body.permissions,
    })

    const after = await getSystemUserById(params.id).catch(() => ({ id: params.id, ...body }))
    await logAuditEvent({
      module: 'accounts',
      action: 'update',
      entityType: 'system-user',
      entityId: params.id,
      entityTitle: after?.name ?? before?.name ?? '',
      summary: `更新帳號：${after?.name ?? before?.name ?? params.id}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
      after,
      metadata: { changedFields: Object.keys(body ?? {}) },
    }).catch((error) => console.error('audit updateSystemUser error:', error))

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('update account error:', error)
    return NextResponse.json({ error: '更新帳號失敗' }, { status: 500 })
  }
})

export const DELETE = withApiAuth('admin', async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  const before = await getSystemUserById(params.id).catch(() => null)
  await deleteSystemUser(params.id)

  await logAuditEvent({
    module: 'accounts',
    action: 'delete',
    entityType: 'system-user',
    entityId: params.id,
    entityTitle: before?.name ?? '',
    summary: `刪除帳號：${before?.name ?? params.id}`,
    actor: getAuditActor(session),
    request: getAuditRequestContext(req),
    before,
  }).catch((error) => console.error('audit deleteSystemUser error:', error))

  return NextResponse.json({ ok: true })
})
