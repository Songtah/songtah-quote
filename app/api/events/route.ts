import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listEvents, createEvent } from '@/lib/system-notion'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const events = await listEvents()
  return NextResponse.json(events)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  const { name, date, endDate, location, type, deadline, status, description } = body

  if (!name || !date || !type || !status) {
    return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 })
  }

  const event = await createEvent({ name, date, endDate, location: location ?? '', type, deadline, status: status ?? '籌備中', description: description ?? '' })
  return NextResponse.json(event)
}
