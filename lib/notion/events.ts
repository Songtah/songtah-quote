/**
 * lib/notion/events.ts — 活動管理 / 報名（從 system-notion.ts 抽出）
 *
 * 報名 DB 同時是「客戶足跡」的唯一來源（2026-09-15）：
 *   課程報名 ← 外掛表單直接寫入 Notion（來源＝報名表單，可只填「表單活動」文字）
 *   展會簽到 ← 系統公開簽到頁 /checkin（來源＝展會簽到，狀態＝已到場）
 * 活動關聯與客戶配對由系統自動補（lib/registration-footprint.ts），不需人工。
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
  campaignIds: string[]   // 關聯追蹤名單(可選,供業務準備↔執行互查)
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
  source:        string   // 報名表單／展會簽到／人工登記（空＝外掛表單未帶）
  formEventName: string   // 外掛表單填的活動名稱，系統據此補「活動」relation
  city:          string
  matchNote:     string   // 系統配對依據或未配對原因
}

export const REGISTRATION_SOURCES = ['報名表單', '展會簽到', '人工登記', '歷史匯入'] as const

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
    campaignIds: (getProp(page, '關聯追蹤名單')?.relation ?? []).map((r: any) => r.id),
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
    source:        getSelect(page, '來源'),
    formEventName: getText(page, '表單活動'),
    city:          getText(page, '縣市'),
    matchNote:     getText(page, '配對說明'),
  }
}

/** 列表快取鍵帶 limit（v2:${limit}），舊版刪的是 v1 鍵，新增/編輯後最多 5 分鐘看不到。逐一清掉常用 limit。 */
function invalidateEventsList() {
  for (const n of [10, 20, 50, 100]) deleteRedisValue(`events-list-v2:${n}`)
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
  campaignIds?: string[]
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
        ...(data.campaignIds?.length ? { '關聯追蹤名單': { relation: data.campaignIds.map((id) => ({ id })) } } : {}),
      },
    })
  )
  invalidateEventsList()
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
  campaignIds: string[]
}>): Promise<void> {
  const props: Record<string, any> = {}
  if (data.name)        props['活動名稱'] = { title: [{ text: { content: data.name } }] }
  if (data.date)        props['日期']     = { date: { start: data.date, ...(data.endDate ? { end: data.endDate } : {}) } }
  if (data.location != null) props['地點'] = { rich_text: [{ text: { content: data.location } }] }
  if (data.type)        props['活動類型'] = { select: { name: data.type } }
  if (data.status)      props['狀態']     = { select: { name: data.status } }
  if (data.description != null) props['簡介'] = { rich_text: [{ text: { content: data.description } }] }
  if (data.deadline)    props['報名截止日'] = { date: { start: data.deadline } }
  if (data.campaignIds !== undefined) props['關聯追蹤名單'] = { relation: data.campaignIds.map((id) => ({ id })) }

  await notionCallWithRetry('updateEvent', () =>
    notion.pages.update({ page_id: id, properties: props })
  )
  invalidateEventsList()
}

export async function deleteEvent(id: string): Promise<void> {
  await notionCallWithRetry('deleteEvent', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  invalidateEventsList()
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

const rt = (v: string) => ({ rich_text: [{ text: { content: v.slice(0, 1900) } }] })

/** 建立報名（展會簽到／人工登記用；外掛表單直接寫 Notion 不經此） */
export async function createRegistration(data: {
  eventId: string
  institution: string
  contact?: string
  phone?: string
  email?: string
  city?: string
  attendees?: number
  status: string
  source: string
  note?: string
}): Promise<EventRegistration> {
  if (!DB.registrations) throw new Error('NOTION_REGISTRATIONS_DB not set')
  const page: any = await notionCallWithRetry('createRegistration', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.registrations!) },
      properties: {
        '機構名稱': { title: [{ text: { content: data.institution.slice(0, 200) } }] },
        '活動':     { relation: [{ id: data.eventId }] },
        '狀態':     { select: { name: data.status } },
        '來源':     { select: { name: data.source } },
        ...(data.contact ? { '聯絡人': rt(data.contact) } : {}),
        ...(data.phone ? { '電話': { phone_number: data.phone } } : {}),
        ...(data.email ? { '信箱': { email: data.email } } : {}),
        ...(data.city ? { '縣市': rt(data.city) } : {}),
        ...(data.attendees ? { '參加人數': { number: data.attendees } } : {}),
        ...(data.note ? { '備註': rt(data.note) } : {}),
      } as any,
    })
  )
  return mapRegistration(page)
}

/** 近 N 天建立的報名（足跡訊號與自動配對共用；報名量小，直接依建立時間過濾） */
export async function listRecentRegistrations(sinceDays: number): Promise<EventRegistration[]> {
  if (!DB.registrations) return []
  const since = new Date(Date.now() - sinceDays * 86400e3).toISOString()
  const items: EventRegistration[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listRecentRegistrations', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.registrations!),
        page_size: 100,
        filter: { timestamp: 'created_time', created_time: { on_or_after: since } } as any,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) items.push(mapRegistration(page))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return items
}

/** 系統補寫：活動關聯／客戶配對／來源／配對說明。只寫有給的欄位。 */
export async function updateRegistrationLinks(id: string, data: {
  eventId?: string; customerId?: string | null; source?: string; matchNote?: string
}): Promise<void> {
  const props: Record<string, any> = {}
  if (data.eventId) props['活動'] = { relation: [{ id: data.eventId }] }
  if (data.customerId !== undefined) props['客戶配對'] = { relation: data.customerId ? [{ id: data.customerId }] : [] }
  if (data.source) props['來源'] = { select: { name: data.source } }
  if (data.matchNote !== undefined) props['配對說明'] = rt(data.matchNote)
  if (!Object.keys(props).length) return
  await notionCallWithRetry('updateRegistrationLinks', () =>
    notion.pages.update({ page_id: id, properties: props })
  )
}

/** 全部活動（輕量；活動數量少，供表單活動名稱比對與足跡顯示活動名稱） */
export async function listAllEvents(): Promise<EventItem[]> {
  if (!DB.events) return []
  const items: EventItem[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listAllEvents', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.events!),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) items.push(mapEvent(page))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return items
}
