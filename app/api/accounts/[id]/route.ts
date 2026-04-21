import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateSystemUser, deleteSystemUser, getSystemUserById } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    const before = await getSystemUserById(params.id).catch(() => null)
    await updateSystemUser(params.id, {
      name: body.name,
      password: body.password || undefined,
      accountType: body.accountType,
      status: body.status,
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
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

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
}
