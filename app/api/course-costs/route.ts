import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listCourseCosts, createCourseCost } from '@/lib/system-notion'
import { canEdit } from '@/lib/permissions'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  const items = await listCourseCosts()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'course_costs')) {
    return NextResponse.json({ error: '無建立辦課成本權限' }, { status: 403 })
  }
  const body = await req.json()
  const item = await createCourseCost(body)
  return NextResponse.json(item, { status: 201 })
}
