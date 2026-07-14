import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createTicket, listSystemTickets } from '@/lib/system-notion'
import type { CreateTicketPayload } from '@/types'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

const TICKET_TYPES = ['技術支援', '維修', 'RMA', '換貨', '客訴', '安裝', '教育訓練']
const TICKET_STATUSES = ['尚未處理', '👌 已受理', '🔍 診斷問題中', '🔧 維修中', '⚙️ 測試中', '🔍 後續追蹤', '✅ 結案']
const PRIORITIES = ['P1', 'P2', 'P3', 'P4']
const SUPPORT_OWNERS = ['小黃', 'Paul', 'Aaron', 'Ted', 'Luca', 'Brain', '致廷']
const SALES_OWNERS = ['公司直營', 'Duncan', 'Gus', 'Hank', 'James', 'Eason', 'Amy', '小郭', 'Paul', 'Chloe']
const MANUFACTURERS = ['ASIGA', 'Zirkonzahn', 'Zirkonzhan', '金泰', 'KO-MAX', 'BSM 貝施美', 'BSM', '普登', 'AR Loupe', 'ACTILINK', 'Graphy', 'HANAU']

const NOTION_PAGE_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validateTicketPayload(body: CreateTicketPayload): string | null {
  const optionChecks: Array<[string, string | undefined, string[]]> = [
    ['案件類型', body.ticketType, TICKET_TYPES],
    ['狀態', body.status || '尚未處理', TICKET_STATUSES],
    ['優先級', body.priority || 'P2', PRIORITIES],
    ['技術支援對口', body.supportOwner, SUPPORT_OWNERS],
    ['業務窗口', body.salesOwner, SALES_OWNERS],
    ['生產商', body.manufacturer, MANUFACTURERS],
  ]
  for (const [label, value, allowed] of optionChecks) {
    if (value && !allowed.includes(value)) return `${label}不是有效選項`
  }

  const relationChecks: Array<[string, string | undefined]> = [
    ['客戶', body.customerId],
    ['設備', body.equipmentId],
    ['產品', body.productId],
  ]
  for (const [label, value] of relationChecks) {
    if (value && !NOTION_PAGE_ID.test(value)) return `${label} relation ID 格式錯誤`
  }

  if (body.scheduledDate && !isValidDateOnly(body.scheduledDate)) {
    return '預計維修日期格式錯誤'
  }
  return null
}

function isRateLimited(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; status?: number; body?: { code?: string } }
  return (
    maybeError.code === 'rate_limited' ||
    maybeError.status === 429 ||
    maybeError.body?.code === 'rate_limited'
  )
}

export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const p = req.nextUrl.searchParams
    const limit = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)
    const cursor = p.get('cursor') ?? undefined
    const result = await listSystemTickets({ limit, cursor })
    return NextResponse.json(result)
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
})

export const POST = withApiAuth({ module: 'rma', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = (await req.json()) as CreateTicketPayload

    if (!body.customerName || !body.title || !body.ticketType || !body.description) {
      return NextResponse.json(
        { error: '客戶、案件標題、案件類型與問題描述為必填' },
        { status: 400 }
      )
    }

    const validationError = validateTicketPayload(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
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
})
