import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { BUSINESS_ASSIGNMENT_MODES, createSystemUser, getSystemUsers, type BusinessAssignmentMode } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const GET = withApiAuth('admin', async () => {
  const users = await getSystemUsers()
  return NextResponse.json(users)
})

export const POST = withApiAuth('admin', async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    if (!body.name || !body.username || !body.password) {
      return NextResponse.json({ error: '缺少必填欄位' }, { status: 400 })
    }
    const assignmentMode = body.accountType === '業務' ? (body.assignmentMode ?? '全面開發') : '全面開發'
    if (!BUSINESS_ASSIGNMENT_MODES.includes(assignmentMode as BusinessAssignmentMode)) {
      return NextResponse.json({ error: '無效的業務承接模式' }, { status: 400 })
    }

    const user = await createSystemUser({
      name: body.name,
      username: body.username,
      password: body.password,
      accountType: body.accountType ?? '業務',
      status: body.status ?? '未開始',
      assignmentMode: assignmentMode as BusinessAssignmentMode,
      permissions: body.permissions,
    })

    await logAuditEvent({
      module: 'accounts',
      action: 'create',
      entityType: 'system-user',
      entityId: user.id,
      entityTitle: user.name,
      summary: `建立帳號：${user.name}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: user,
      metadata: { username: user.username },
    }).catch((error) => console.error('audit createSystemUser error:', error))

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('create account error:', error)
    return NextResponse.json({ error: '建立帳號失敗' }, { status: 500 })
  }
})
