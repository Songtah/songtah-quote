import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateCourseCost, deleteCourseCost } from '@/lib/system-notion'
import { canEdit } from '@/lib/permissions'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'course_costs')) {
    return NextResponse.json({ error: '無編輯辦課成本權限' }, { status: 403 })
  }
  const body = await req.json()
  await updateCourseCost(params.id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'course_costs')) {
    return NextResponse.json({ error: '無刪除辦課成本權限' }, { status: 403 })
  }
  await deleteCourseCost(params.id)
  return NextResponse.json({ ok: true })
}
