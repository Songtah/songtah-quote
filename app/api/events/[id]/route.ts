import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getEventById, updateEvent, deleteEvent, listEventRegistrations,
  updateRegistrationStatus, getRegistrationById,
} from '@/lib/system-notion'
import { getSystemCustomerById } from '@/lib/notion/customers'
import { createVisit } from '@/lib/notion/visits'
import { canEdit } from '@/lib/permissions'

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
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無編輯活動權限' }, { status: 403 })
  }

  const { id } = params
  const body = await req.json()

  // If updating a registration status
  if (body._type === 'registration') {
    const before = await getRegistrationById(id)
    await updateRegistrationStatus(id, body.status)

    // 報名確認且已配對客戶 → 自動產生一筆待追蹤客情,提醒業務活動後跟進
    // (不新增 Notion schema,重用既有拜訪 DB 的「是否需追蹤」機制)
    if (body.status === '已確認' && before && before.status !== '已確認' && before.customerId) {
      try {
        const [event, customer] = await Promise.all([
          getEventById(before.eventId),
          getSystemCustomerById(before.customerId),
        ])
        await createVisit({
          customerName: customer?.name || before.institution || '活動報名客戶',
          date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
          salesperson: customer?.salesperson ?? '',
          content: `活動報名確認：「${event?.name ?? ''}」，請安排跟進拜訪，了解活動後續需求。`,
          address: '',
          city: customer?.city ?? '',
          district: customer?.district ?? '',
          customerId: before.customerId,
          needsFollowUp: true,
          followUpAction: '活動後跟進',
        })
      } catch (e) {
        console.error('events registration → 自動待追蹤建立失敗', e)
      }
    }

    return NextResponse.json({ ok: true })
  }

  await updateEvent(id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無刪除活動權限' }, { status: 403 })
  }

  await deleteEvent(params.id)
  return NextResponse.json({ ok: true })
}
