import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateSystemUser, deleteSystemUser } from '@/lib/system-notion'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  await updateSystemUser(params.id, {
    name: body.name,
    password: body.password || undefined,
    accountType: body.accountType,
    status: body.status,
    permissions: body.permissions,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  await deleteSystemUser(params.id)
  return NextResponse.json({ ok: true })
}
