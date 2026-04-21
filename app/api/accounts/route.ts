import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createSystemUser, getSystemUsers } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const users = await getSystemUsers()
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    if (!body.name || !body.username || !body.password) {
      return NextResponse.json({ error: '缺少必填欄位' }, { status: 400 })
    }

    const user = await createSystemUser({
      name: body.name,
      username: body.username,
      password: body.password,
      accountType: body.accountType ?? '業務',
      status: body.status ?? '未開始',
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
}
