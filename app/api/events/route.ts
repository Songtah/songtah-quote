import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listEvents, createEvent } from '@/lib/system-notion'
import { canEdit } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const limit = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)
  const cursor = p.get('cursor') ?? undefined
  const result = await listEvents({ limit, cursor })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無建立活動權限' }, { status: 403 })
  }

  const body = await req.json()
  const { name, date, endDate, location, type, deadline, status, description } = body

  if (!name || !date || !type || !status) {
    return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 })
  }

  const event = await createEvent({ name, date, endDate, location: location ?? '', type, deadline, status: status ?? '籌備中', description: description ?? '' })
  return NextResponse.json(event)
}
