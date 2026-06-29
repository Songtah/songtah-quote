/**
 * lib/notion/tickets.ts — 工單 / RMA（葉領域，從 system-notion.ts 抽出）
 * 客戶名稱解析走 ./relations（跨切面），不直接 import customers。
 */
import type { CreateTicketPayload, Ticket } from '@/types'
import {
  notion, DB, transientCache, normalizeDatabaseId, notionCallWithRetry,
  getCachedValue, setCachedValue, richText,
  getTitle, getText, getSelect, getDate, getRelationIds, getRollupText,
} from './shared'
import { resolveCustomerNames } from './relations'

export async function listCustomerTickets(customerId: string): Promise<Ticket[]> {
  if (!DB.tickets) return []
  const cacheKey = `customer-tickets:${customerId}`
  const cached = getCachedValue<Ticket[]>(cacheKey)
  if (cached) return cached

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

  setCachedValue(cacheKey, items, 180_000) // 3 min
  return items
}

function getTicketNumber(page: any): string {
  const uid = page.properties?.['編號']?.unique_id
  if (!uid?.number) return ''
  const prefix = uid.prefix || 'RMA'
  return `${prefix}-${uid.number}`
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
    number: getTicketNumber(page),
    customerName: titleFallback,          // overwritten after relation resolved
    title: getText(page, '案件標題') || titleFallback,
    ticketType: getSelect(page, '故障分類') || getSelect(page, '案件類型'),
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
          ? { 案件類型: { select: { name: payload.ticketType } } }
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
          ? { '全台牙科相關單位名單': { relation: [{ id: payload.customerId }] } }
          : {}),
        ...(payload.productId
          ? { 產品資料庫: { relation: [{ id: payload.productId }] } }
          : {}),
      } as any,
    })
  )

  transientCache.delete('tickets:list')

  return {
    id: response.id,
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

export async function listSystemTickets(options?: {
  limit?: number
  cursor?: string
}): Promise<{ items: Ticket[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = options?.limit ?? 10
  const cursor = options?.cursor

  // 只有第一頁（無 cursor）才用 cache
  if (!cursor) {
    const cacheKey = `tickets:list:v2:${limit}`
    const cached = getCachedValue<{ items: Ticket[]; hasMore: boolean; nextCursor: string | null }>(cacheKey)
    if (cached) return cached

    const response: any = await notionCallWithRetry('listSystemTickets', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.tickets),
        page_size: limit,
        sorts: [{ property: '建立日期', direction: 'descending' }],
      })
    )
    const rawItems = (response.results ?? []).map(mapTicketPageRaw)
    const items = (await resolveTicketNames(rawItems)) as Ticket[]
    const result = {
      items,
      hasMore: response.has_more ?? false,
      nextCursor: response.next_cursor ?? null,
    }
    setCachedValue(cacheKey, result, 180_000)
    return result
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
  const cacheKey = `ticket:${id}`
  const cached = getCachedValue<Omit<ReturnType<typeof mapTicketPageRaw>, '_relId'>>(cacheKey)
  if (cached) return cached

  const page: any = await notionCallWithRetry('getSystemTicketById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  const [ticket] = await resolveTicketNames([mapTicketPageRaw(page)])
  setCachedValue(cacheKey, ticket, 300_000) // 5 min
  return ticket
}
