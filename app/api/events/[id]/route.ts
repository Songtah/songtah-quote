import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getEventById, updateEvent, deleteEvent, listEventRegistrations, updateRegistrationStatus } from '@/lib/system-notion'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = params
  const url = new URL(req.url)

  if (url.searchParams.get('registrations') === '1') {
    const regs = await listEventRegistrations(id)
    return NextResponse.json(regs)
  }

  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  return NextResponse.json(event)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = params
  const body = await req.json()

  // If updating a registration status
  if (body._type === 'registration') {
    await updateRegistrationStatus(id, body.status)
    return NextResponse.json({ ok: true })
  }

  await updateEvent(id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  await deleteEvent(params.id)
  return NextResponse.json({ ok: true })
}
