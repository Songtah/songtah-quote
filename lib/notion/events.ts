/**
 * lib/notion/events.ts — 活動管理 / 報名（從 system-notion.ts 抽出）
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getRedisValue, setRedisValue, deleteRedisValue,
  getProp, getTitle, getText, getSelect, getNumber, getDate,
} from './shared'

export type EventItem = {
  id:          string
  name:        string
  date:        string   // ISO date
  endDate:     string   // ISO date (optional range end)
  location:    string
  type:        string
  deadline:    string   // 報名截止日
  status:      string
  description: string
  createdAt:   string
}

export type EventRegistration = {
  id:            string
  institution:   string
  contact:       string
  email:         string
  phone:         string
  attendees:     number
  status:        string
  note:          string
  registeredAt:  string
  eventId:       string
  customerId:    string   // 客戶配對 relation (first ID)
}

function mapEvent(page: any): EventItem {
  return {
    id:          page.id,
    name:        getTitle(page, '活動名稱'),
    date:        getDate(page, '日期'),
    endDate:     getProp(page, '日期')?.date?.end ?? '',
    location:    getText(page, '地點'),
    type:        getSelect(page, '活動類型'),
    deadline:    getDate(page, '報名截止日'),
    status:      getSelect(page, '狀態'),
    description: getText(page, '簡介'),
    createdAt:   getProp(page, '建立時間')?.created_time ?? '',
  }
}

function mapRegistration(page: any): EventRegistration {
  const eventRel  = getProp(page, '活動')?.relation ?? []
  const custRel   = getProp(page, '客戶配對')?.relation ?? []
  return {
    id:           page.id,
    institution:  getTitle(page, '機構名稱'),
    contact:      getText(page, '聯絡人'),
    email:        getProp(page, '信箱')?.email ?? '',
    phone:        getProp(page, '電話')?.phone_number ?? '',
    attendees:    getNumber(page, '參加人數'),
    status:       getSelect(page, '狀態'),
    note:         getText(page, '備註'),
    registeredAt: getProp(page, '報名時間')?.created_time ?? '',
    eventId:      eventRel[0]?.id ?? '',
    customerId:   custRel[0]?.id ?? '',
  }
}

export async function listEvents(options?: {
  limit?: number
  cursor?: string
}): Promise<{ items: EventItem[]; hasMore: boolean; nextCursor: string | null }> {
  if (!DB.events) return { items: [], hasMore: false, nextCursor: null }
  const limit = options?.limit ?? 10
  const startCursor = options?.cursor

  if (!startCursor) {
    const cacheKey = `events-list-v2:${limit}`
    const cached = await getRedisValue<{ items: EventItem[]; hasMore: boolean; nextCursor: string | null }>(cacheKey)
    if (cached) return cached

    const res: any = await notionCallWithRetry('listEvents', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.events!),
        page_size: limit,
        sorts: [{ property: '日期', direction: 'descending' }],
      })
    )
    const items: EventItem[] = (res.results ?? []).map(mapEvent)
    const result = {
      items,
      hasMore: res.has_more ?? false,
      nextCursor: res.next_cursor ?? null,
    }
    await setRedisValue(cacheKey, result, 5 * 60_000)
    return result
  }

  const res: any = await notionCallWithRetry('listEvents', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.events!),
      page_size: limit,
      sorts: [{ property: '日期', direction: 'descending' }],
      start_cursor: startCursor,
    })
  )
  return {
    items: (res.results ?? []).map(mapEvent),
    hasMore: res.has_more ?? false,
    nextCursor: res.next_cursor ?? null,
  }
}

export async function getEventById(id: string): Promise<EventItem | null> {
  try {
    const page: any = await notionCallWithRetry('getEventById', () =>
      notion.pages.retrieve({ page_id: id })
    )
    return mapEvent(page)
  } catch {
    return null
  }
}

export async function createEvent(data: {
  name:        string
  date:        string
  endDate?:    string
  location:    string
  type:        string
  deadline?:   string
  status:      string
  description: string
}): Promise<EventItem> {
  if (!DB.events) throw new Error('NOTION_EVENTS_DB not set')
  const page: any = await notionCallWithRetry('createEvent', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.events!) },
      properties: {
        '活動名稱': { title: [{ text: { content: data.name } }] },
        '日期':     { date: { start: data.date, ...(data.endDate ? { end: data.endDate } : {}) } },
        '地點':     { rich_text: [{ text: { content: data.location } }] },
        '活動類型': { select: { name: data.type } },
        '狀態':     { select: { name: data.status } },
        '簡介':     { rich_text: [{ text: { content: data.description } }] },
        ...(data.deadline ? { '報名截止日': { date: { start: data.deadline } } } : {}),
      },
    })
  )
  deleteRedisValue('events-list-v1')
  return mapEvent(page)
}

export async function updateEvent(id: string, data: Partial<{
  name:        string
  date:        string
  endDate:     string
  location:    string
  type:        string
  deadline:    string
  status:      string
  description: string
}>): Promise<void> {
  const props: Record<string, any> = {}
  if (data.name)        props['活動名稱'] = { title: [{ text: { content: data.name } }] }
  if (data.date)        props['日期']     = { date: { start: data.date, ...(data.endDate ? { end: data.endDate } : {}) } }
  if (data.location != null) props['地點'] = { rich_text: [{ text: { content: data.location } }] }
  if (data.type)        props['活動類型'] = { select: { name: data.type } }
  if (data.status)      props['狀態']     = { select: { name: data.status } }
  if (data.description != null) props['簡介'] = { rich_text: [{ text: { content: data.description } }] }
  if (data.deadline)    props['報名截止日'] = { date: { start: data.deadline } }

  await notionCallWithRetry('updateEvent', () =>
    notion.pages.update({ page_id: id, properties: props })
  )
  deleteRedisValue('events-list-v1')
}

export async function deleteEvent(id: string): Promise<void> {
  await notionCallWithRetry('deleteEvent', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  deleteRedisValue('events-list-v1')
}

export async function listEventRegistrations(eventId: string): Promise<EventRegistration[]> {
  if (!DB.registrations) return []
  const items: EventRegistration[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listEventRegistrations', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.registrations!),
        page_size: 100,
        filter: {
          property: '活動',
          relation: { contains: eventId },
        },
        sorts: [{ property: '報名時間', direction: 'ascending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      items.push(mapRegistration(page))
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return items
}

export async function listCustomerEvents(customerId: string): Promise<EventRegistration[]> {
  if (!DB.registrations) return []
  const items: EventRegistration[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listCustomerEvents', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.registrations!),
        page_size: 100,
        filter: {
          property: '客戶配對',
          relation: { contains: customerId },
        },
        sorts: [{ property: '報名時間', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      items.push(mapRegistration(page))
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return items
}

export async function getRegistrationById(id: string): Promise<EventRegistration | null> {
  try {
    const page: any = await notionCallWithRetry('getRegistrationById', () =>
      notion.pages.retrieve({ page_id: id })
    )
    return mapRegistration(page)
  } catch {
    return null
  }
}

export async function updateRegistrationStatus(id: string, status: string): Promise<void> {
  await notionCallWithRetry('updateRegistrationStatus', () =>
    notion.pages.update({
      page_id: id,
      properties: { '狀態': { select: { name: status } } },
    })
  )
}
