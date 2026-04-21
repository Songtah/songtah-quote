import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createTicket, listSystemTickets } from '@/lib/system-notion'
import type { CreateTicketPayload } from '@/types'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

function isRateLimited(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; status?: number; body?: { code?: string } }
  return (
    maybeError.code === 'rate_limited' ||
    maybeError.status === 429 ||
    maybeError.body?.code === 'rate_limited'
  )
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const tickets = await listSystemTickets()
    return NextResponse.json(tickets)
  } catch (error) {
    console.error('listSystemTickets error:', error)
    return NextResponse.json(
      {
        error: isRateLimited(error)
          ? 'Notion 目前忙碌中，工單資料暫時無法同步，請稍後再試。'
          : '無法取得工單資料',
      },
      { status: isRateLimited(error) ? 429 : 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = (await req.json()) as CreateTicketPayload

    if (!body.customerName || !body.title || !body.ticketType || !body.description) {
      return NextResponse.json(
        { error: '客戶、案件標題、案件類型與問題描述為必填' },
        { status: 400 }
      )
    }

    const ticket = await createTicket({
      ...body,
      status: body.status || '尚未處理',
      priority: body.priority || 'P2',
    })

    await logAuditEvent({
      module: 'rma',
      action: 'create',
      entityType: 'ticket',
      entityId: ticket.id,
      entityTitle: ticket.title || ticket.number,
      summary: `建立工單：${ticket.number} ${ticket.title || ticket.customerName}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: ticket,
    }).catch((error) => console.error('audit createTicket error:', error))

    return NextResponse.json(ticket, { status: 201 })
  } catch (error) {
    console.error('createTicket error:', error)
    return NextResponse.json(
      {
        error: isRateLimited(error)
          ? 'Notion 目前忙碌中，暫時無法建立工單，請稍後再試。'
          : '建立工單失敗',
      },
      { status: isRateLimited(error) ? 429 : 500 }
    )
  }
}
