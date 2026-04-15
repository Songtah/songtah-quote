import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createSystemUser, getSystemUsers } from '@/lib/system-notion'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const users = await getSystemUsers()
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  if (!body.name || !body.username || !body.password) {
    return NextResponse.json({ error: '缺少必填欄位' }, { status: 400 })
  }

  await createSystemUser({
    name: body.name,
    username: body.username,
    password: body.password,
    accountType: body.accountType ?? '業務',
    permissions: body.permissions,
  })

  return NextResponse.json({ ok: true })
}
