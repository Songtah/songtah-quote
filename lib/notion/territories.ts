/**
 * lib/notion/territories.ts — 業務轄區設定（葉領域）
 *
 * 只管理地理責任設定，不讀寫客戶主檔。客戶認領由上層 route 組合
 * territories + customers，避免「新增轄區」污染負責業務與轉化統計。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  richText, getTitle, getText, getSelect, getDate,
} from './shared'

export const TERRITORY_STATUSES = ['規劃中', '開發中', '暫停', '結束'] as const
export type TerritoryStatus = (typeof TERRITORY_STATUSES)[number]

export type Territory = {
  id: string
  name: string
  city: string
  district: string
  salesperson: string
  salespersonId: string
  status: TerritoryStatus | string
  startDate: string
  note: string
  creator: string
  createdAt: string
}

function mapTerritory(page: any): Territory {
  return {
    id: page.id,
    name: getTitle(page, '轄區名稱'),
    city: getSelect(page, '縣市'),
    district: getText(page, '行政區'),
    salesperson: getSelect(page, '負責業務'),
    salespersonId: getText(page, '負責業務ID'),
    status: getSelect(page, '狀態') || '規劃中',
    startDate: getDate(page, '生效日'),
    note: getText(page, '備註'),
    creator: getText(page, '建立者'),
    createdAt: page.created_time ?? '',
  }
}

export async function listTerritories(options: { includeEnded?: boolean } = {}): Promise<Territory[]> {
  if (!DB.territories) return []
  const out: Territory[] = []
  let cursor: string | undefined
  do {
    const response: any = await notionCallWithRetry('listTerritories', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.territories),
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        ...(options.includeEnded ? {} : { filter: { property: '狀態', select: { does_not_equal: '結束' } } }),
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    out.push(...(response.results ?? []).map(mapTerritory))
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)
  return out
}

async function assertAreaAvailable(city: string, district: string, excludeId?: string) {
  const territories = await listTerritories()
  const conflict = territories.find((item) =>
    item.id !== excludeId && item.city === city && item.district === district
  )
  if (conflict) {
    throw new Error(`${city}${district} 已由 ${conflict.salesperson} 負責`)
  }
}

export async function createTerritory(data: {
  city: string
  district: string
  salesperson: string
  salespersonId: string
  status?: TerritoryStatus
  startDate?: string
  note?: string
  creator?: string
}): Promise<Territory> {
  await assertAreaAvailable(data.city, data.district)
  const name = `${data.city}${data.district}｜${data.salesperson}`
  const page: any = await notionCallWithRetry('createTerritory', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.territories) },
      properties: {
        '轄區名稱': { title: richText(name) },
        '縣市': { select: { name: data.city } },
        '行政區': { rich_text: richText(data.district) },
        '負責業務': { select: { name: data.salesperson } },
        '負責業務ID': { rich_text: richText(data.salespersonId) },
        '狀態': { select: { name: data.status ?? '規劃中' } },
        ...(data.startDate ? { '生效日': { date: { start: data.startDate } } } : {}),
        ...(data.note ? { '備註': { rich_text: richText(data.note) } } : {}),
        ...(data.creator ? { '建立者': { rich_text: richText(data.creator) } } : {}),
      } as any,
    })
  )
  return mapTerritory(page)
}

export async function getTerritory(id: string): Promise<Territory> {
  const page: any = await notionCallWithRetry('getTerritory', () =>
    notion.pages.retrieve({ page_id: id })
  )
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const territoriesDb = normalizeDatabaseId(DB.territories).replace(/-/g, '')
  if (!targetDb || targetDb !== territoriesDb || page.archived) {
    throw new Error('找不到轄區')
  }
  return mapTerritory(page)
}

export async function updateTerritory(id: string, data: {
  salesperson?: string
  salespersonId?: string
  status?: TerritoryStatus
  startDate?: string | null
  note?: string
}): Promise<Territory> {
  const current = await getTerritory(id)
  const properties: Record<string, any> = {}
  const salesperson = data.salesperson?.trim()
  if (salesperson) {
    properties['負責業務'] = { select: { name: salesperson } }
    properties['轄區名稱'] = { title: richText(`${current.city}${current.district}｜${salesperson}`) }
  }
  if (data.salespersonId) properties['負責業務ID'] = { rich_text: richText(data.salespersonId) }
  if (data.status) properties['狀態'] = { select: { name: data.status } }
  if (data.startDate !== undefined) {
    properties['生效日'] = data.startDate ? { date: { start: data.startDate } } : { date: null }
  }
  if (data.note !== undefined) properties['備註'] = { rich_text: richText(data.note) }
  if (Object.keys(properties).length) {
    await notionCallWithRetry('updateTerritory', () =>
      notion.pages.update({ page_id: id, properties: properties as any })
    )
  }
  return getTerritory(id)
}
