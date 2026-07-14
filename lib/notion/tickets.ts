/**
 * lib/notion/tickets.ts — 工單 / RMA（葉領域，從 system-notion.ts 抽出）
 * 客戶名稱解析走 ./relations（跨切面），不直接 import customers。
 */
import type { CreateTicketPayload, Ticket, UpdateTicketPayload } from '@/types'
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry, richText,
  getTitle, getText, getSelect, getDate, getRelationIds, getRollupText,
} from './shared'
import { resolveCustomerNames } from './relations'

export async function listCustomerTickets(customerId: string): Promise<Ticket[]> {
  if (!DB.tickets) return []

  const response: any = await notionCallWithRetry('listCustomerTickets', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.tickets),
      page_size: 50,
      filter: { property: '🏥 牙科單位資料', relation: { contains: customerId } },
      sorts: [{ property: '建立日期', direction: 'descending' }],
    })
  )

  const rawItems = (response.results ?? []).map(mapTicketPageRaw)
  const items = (await resolveTicketNames(rawItems)) as Ticket[]
  return items
}

function getTicketNumber(page: any): string {
  const uid = page.properties?.['編號']?.unique_id
  if (!uid?.number) return ''
  const prefix = uid.prefix || 'RMA'
  return `${prefix}-${uid.number}`
}

function getMultiSelectNames(page: any, field: string): string {
  const property = page.properties?.[field]
  if (property?.type !== 'multi_select') return ''
  return (property.multi_select ?? [])
    .map((item: any) => item.name)
    .filter(Boolean)
    .join(', ')
}

/** Returns true when a string looks like an ISO 8601 datetime (Notion automation artefact). */
function isIsoDatetime(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.trim())
}

/** Raw mapper — includes _relId for async name resolution. */
function mapTicketPageRaw(page: any) {
  const rawCustomerName = getTitle(page, '客戶單位')
  const titleFallback = isIsoDatetime(rawCustomerName) ? '' : rawCustomerName
  return {
    id: page.id,
    _relId: getRelationIds(page, '🏥 牙科單位資料')[0] ?? '',
    equipmentId: getRelationIds(page, '設備資料')[0] ?? '',
    number: getTicketNumber(page),
    customerName: titleFallback,          // overwritten after relation resolved
    title: getText(page, '案件標題') || titleFallback,
    ticketType: getMultiSelectNames(page, '故障分類') || getSelect(page, '案件類型'),
    status: getSelect(page, '狀態'),
    priority: getSelect(page, '優先級'),
    scheduledDate: getDate(page, '預計維修日期（外派）'),
    contactName: getText(page, '聯絡人'),
    description: getText(page, '情境描述'),
    supportOwner: getSelect(page, '技術支援對口'),
    salesOwner: getSelect(page, '業務窗口'),
    cause: getText(page, '原因'),
    solution: getText(page, '解決方案'),
    note: getText(page, '備註'),
    manufacturer: getSelect(page, '生產商') || getRollupText(page, '品牌'),
    createdDate: getDate(page, '建立日期'),
  }
}

/** Resolve names then strip _relId. */
async function resolveTicketNames<T extends { _relId: string; customerName: string; title: string }>(
  rawItems: T[]
): Promise<Omit<T, '_relId'>[]> {
  const nameMap = await resolveCustomerNames(rawItems.map((t) => t._relId))
  return rawItems.map((raw) => {
    const { _relId, ...rest } = raw as any
    const resolved = (_relId && nameMap[_relId]) || rest.customerName
    return {
      ...rest,
      customerName: resolved,
      title: rest.title || resolved,
    }
  })
}

function mapManufacturerOption(value: string) {
  const mapping: Record<string, string> = {
    'BSM 貝施美': 'BSM',
    Zirkonzahn: 'Zirkonzhan',
  }
  return mapping[value] ?? value
}

export async function createTicket(payload: CreateTicketPayload): Promise<Ticket> {
  const createdAt = new Date().toISOString().slice(0, 10)
  const response: any = await notionCallWithRetry('createTicket', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.tickets) },
      properties: {
        客戶單位: { title: richText(payload.customerName) },
        ...(payload.priority
          ? { 優先級: { select: { name: payload.priority } } }
          : {}),
        ...(payload.status ? { 狀態: { status: { name: payload.status } } } : {}),
        ...(payload.supportOwner
          ? { 技術支援對口: { select: { name: payload.supportOwner } } }
          : {}),
        ...(payload.salesOwner
          ? { 業務窗口: { select: { name: payload.salesOwner } } }
          : {}),
        ...(payload.title
          ? { 案件標題: { rich_text: richText(payload.title) } }
          : {}),
        ...(payload.ticketType
          ? { 故障分類: { multi_select: [{ name: payload.ticketType }] } }
          : {}),
        ...(payload.contactName
          ? { 聯絡人: { rich_text: richText(payload.contactName) } }
          : {}),
        ...(payload.description
          ? { 情境描述: { rich_text: richText(payload.description) } }
          : {}),
        ...(payload.cause ? { 原因: { rich_text: richText(payload.cause) } } : {}),
        ...(payload.solution
          ? { 解決方案: { rich_text: richText(payload.solution) } }
          : {}),
        ...(payload.keyPart
          ? { 關鍵料件: { rich_text: richText(payload.keyPart) } }
          : {}),
        ...(payload.note
          ? { 備註: { rich_text: richText(payload.note) } }
          : {}),
        ...(payload.scheduledDate
          ? {
              '預計維修日期（外派）': {
                date: {
                  start: payload.scheduledDate,
                },
              },
            }
          : {}),
        建立日期: {
          date: {
            start: createdAt,
          },
        },
        ...(payload.manufacturer
          ? { 生產商: { select: { name: mapManufacturerOption(payload.manufacturer) } } }
          : {}),
        ...(payload.customerId
          ? { '🏥 牙科單位資料': { relation: [{ id: payload.customerId }] } }
          : {}),
        ...(payload.equipmentId
          ? { 設備資料: { relation: [{ id: payload.equipmentId }] } }
          : {}),
        ...(payload.productId
          ? { 產品資料庫: { relation: [{ id: payload.productId }] } }
          : {}),
      } as any,
    })
  )

  return {
    id: response.id,
    equipmentId: payload.equipmentId,
    number: getTicketNumber(response),
    customerName: payload.customerName,
    title: payload.title,
    ticketType: payload.ticketType,
    status: payload.status,
    priority: payload.priority,
    scheduledDate: payload.scheduledDate ?? '',
    contactName: payload.contactName,
    description: payload.description,
    supportOwner: payload.supportOwner,
    salesOwner: payload.salesOwner,
  }
}

export async function updateTicket(id: string, data: UpdateTicketPayload): Promise<void> {
  const properties: Record<string, any> = {}

  if (data.status !== undefined) properties['狀態'] = { status: { name: data.status } }
  if (data.priority !== undefined) {
    properties['優先級'] = { select: data.priority ? { name: data.priority } : null }
  }
  if (data.supportOwner !== undefined) {
    properties['技術支援對口'] = { select: data.supportOwner ? { name: data.supportOwner } : null }
  }
  if (data.salesOwner !== undefined) {
    properties['業務窗口'] = { select: data.salesOwner ? { name: data.salesOwner } : null }
  }
  if (data.scheduledDate !== undefined) {
    properties['預計維修日期（外派）'] = {
      date: data.scheduledDate ? { start: data.scheduledDate } : null,
    }
  }
  if (data.cause !== undefined) {
    properties['原因'] = { rich_text: data.cause ? richText(data.cause) : [] }
  }
  if (data.solution !== undefined) {
    properties['解決方案'] = { rich_text: data.solution ? richText(data.solution) : [] }
  }
  if (data.note !== undefined) {
    properties['備註'] = { rich_text: data.note ? richText(data.note) : [] }
  }
  if (data.equipmentId !== undefined) {
    properties['設備資料'] = { relation: data.equipmentId ? [{ id: data.equipmentId }] : [] }
  }

  await notionCallWithRetry('updateTicket', () =>
    notion.pages.update({ page_id: id, properties: properties as any })
  )
}

export async function listSystemTickets(options?: {
  limit?: number
  cursor?: string
}): Promise<{ items: Ticket[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = options?.limit ?? 10
  const cursor = options?.cursor

  if (!cursor) {
    const response: any = await notionCallWithRetry('listSystemTickets', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.tickets),
        page_size: limit,
        sorts: [{ property: '建立日期', direction: 'descending' }],
      })
    )
    const rawItems = (response.results ?? []).map(mapTicketPageRaw)
    const items = (await resolveTicketNames(rawItems)) as Ticket[]
    return {
      items,
      hasMore: response.has_more ?? false,
      nextCursor: response.next_cursor ?? null,
    }
  }

  // cursor 分頁
  const response: any = await notionCallWithRetry('listSystemTickets', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.tickets),
      page_size: limit,
      sorts: [{ property: '建立日期', direction: 'descending' }],
      start_cursor: cursor,
    })
  )
  const rawItems = (response.results ?? []).map(mapTicketPageRaw)
  const items = (await resolveTicketNames(rawItems)) as Ticket[]
  return {
    items,
    hasMore: response.has_more ?? false,
    nextCursor: response.next_cursor ?? null,
  }
}

export async function getSystemTicketById(id: string) {
  const page: any = await notionCallWithRetry('getSystemTicketById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  const [ticket] = await resolveTicketNames([mapTicketPageRaw(page)])
  return ticket
}
