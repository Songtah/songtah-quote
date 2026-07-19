import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemTicketById, updateTicket } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { validateUpdateTicketPayload, isValidTicketStatusTransition } from '@/lib/ticket-validation'
import type { Ticket, UpdateTicketPayload } from '@/types'

function notionErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 500
  const value = error as { code?: string; status?: number; body?: { code?: string } }
  if (value.code === 'validation_error' || value.status === 400 || value.body?.code === 'validation_error') return 400
  if (value.code === 'object_not_found' || value.status === 404 || value.body?.code === 'object_not_found') return 404
  if (value.code === 'rate_limited' || value.status === 429 || value.body?.code === 'rate_limited') return 429
  return 500
}

function errorMessage(status: number, action: '讀取' | '更新') {
  if (status === 400) return '更新內容與資料庫欄位不相容'
  if (status === 404) return '找不到案件'
  if (status === 429) return 'Notion 目前忙碌中，請稍後再試'
  return `${action}案件失敗`
}

function applyTicketUpdate(ticket: Ticket, data: UpdateTicketPayload): Ticket {
  const optionalValueAfterUpdate = (current: string | undefined, next: string | undefined) =>
    next === undefined ? current : next || undefined
  const requiredValueAfterUpdate = (current: string, next: string | undefined) =>
    next === undefined ? current : next

  return {
    ...ticket,
    ...data,
    priority: requiredValueAfterUpdate(ticket.priority, data.priority),
    supportOwner: requiredValueAfterUpdate(ticket.supportOwner, data.supportOwner),
    salesOwner: requiredValueAfterUpdate(ticket.salesOwner, data.salesOwner),
    scheduledDate: requiredValueAfterUpdate(ticket.scheduledDate, data.scheduledDate),
    cause: optionalValueAfterUpdate(ticket.cause, data.cause),
    solution: optionalValueAfterUpdate(ticket.solution, data.solution),
    note: optionalValueAfterUpdate(ticket.note, data.note),
    equipmentId: optionalValueAfterUpdate(ticket.equipmentId, data.equipmentId),
  }
}

export const GET = withApiAuth({ module: 'rma', action: 'view' }, async (_req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    const ticket = await getSystemTicketById(params.id)
    return NextResponse.json(ticket)
  } catch (error) {
    const status = notionErrorStatus(error)
    return NextResponse.json({ error: errorMessage(status, '讀取') }, { status })
  }
})

export const PATCH = withApiAuth({ module: 'rma', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '更新內容不是有效的 JSON' }, { status: 400 })
  }

  const validation = validateUpdateTicketPayload(body)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  try {
    const before = await getSystemTicketById(params.id) as Ticket

    if (validation.data.status !== undefined && !isValidTicketStatusTransition(before.status, validation.data.status)) {
      return NextResponse.json(
        { error: `狀態不可從「${before.status}」改為「${validation.data.status}」` },
        { status: 400 }
      )
    }

    await updateTicket(params.id, validation.data)
    let after = applyTicketUpdate(before, validation.data)
    let readBack: 'passed' | 'failed' = 'failed'
    try {
      after = await getSystemTicketById(params.id) as Ticket
      readBack = 'passed'
    } catch (error) {
      console.error('updateTicket read-back error:', error)
    }

    await logAuditEvent({
      module: 'rma',
      action: 'update',
      entityType: 'ticket',
      entityId: params.id,
      entityTitle: after.title || after.number || before.title,
      summary: `更新工單：${after.number || params.id}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
      after,
      metadata: { changedFields: validation.changedFields, readBack },
    }).catch((error) => console.error('audit updateTicket error:', error))

    return NextResponse.json(after)
  } catch (error) {
    console.error('updateTicket error:', error)
    const status = notionErrorStatus(error)
    return NextResponse.json({ error: errorMessage(status, '更新') }, { status })
  }
})
