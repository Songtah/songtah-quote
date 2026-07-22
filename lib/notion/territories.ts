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
import {
  BlobNotFoundError, BlobPreconditionFailedError, del, head, put,
} from '@vercel/blob'

const TERRITORY_LOCK_PATH = 'system-locks/territory-mutation.lock'
const TERRITORY_LOCK_STALE_MS = 6 * 60_000
let localMutationRunning = false

export class TerritoryMutationBusyError extends Error {
  constructor() {
    super('另一筆轄區設定正在處理，請稍後再試')
    this.name = 'TerritoryMutationBusyError'
  }
}

async function acquireTerritoryMutationLock(): Promise<() => Promise<void>> {
  if (localMutationRunning) throw new TerritoryMutationBusyError()
  localMutationRunning = true

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    if (process.env.VERCEL) {
      localMutationRunning = false
      throw new Error('缺少跨執行個體鎖定設定，已拒絕寫入轄區')
    }
    return async () => { localMutationRunning = false }
  }

  const createLock = async () => {
    try {
      return await put(TERRITORY_LOCK_PATH, new Date().toISOString(), {
        access: 'public', addRandomSuffix: false, allowOverwrite: false,
        cacheControlMaxAge: 60, contentType: 'text/plain', token,
      })
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || /already exists|not allowed to overwrite/i.test(String(error))) {
        return null
      }
      throw error
    }
  }

  try {
    let lock = await createLock()
    if (!lock) {
      try {
        const existing = await head(TERRITORY_LOCK_PATH, { token })
        if (Date.now() - existing.uploadedAt.getTime() > TERRITORY_LOCK_STALE_MS) {
          await del(TERRITORY_LOCK_PATH, { ifMatch: existing.etag, token })
          lock = await createLock()
        }
      } catch (error) {
        if (!(error instanceof BlobNotFoundError) && !(error instanceof BlobPreconditionFailedError)) throw error
        lock = await createLock()
      }
    }
    if (!lock) throw new TerritoryMutationBusyError()
    return async () => {
      try {
        await del(TERRITORY_LOCK_PATH, { ifMatch: lock.etag, token })
      } catch (error) {
        console.error('territory mutation lock release error:', error)
      } finally {
        localMutationRunning = false
      }
    }
  } catch (error) {
    localMutationRunning = false
    throw error
  }
}

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

export type CreateTerritoryInput = {
  city: string
  district: string
  salesperson: string
  salespersonId: string
  status?: TerritoryStatus
  startDate?: string
  note?: string
  creator?: string
}

async function createTerritoryPage(data: CreateTerritoryInput): Promise<Territory> {
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

export async function createTerritories(data: CreateTerritoryInput[]): Promise<Territory[]> {
  const releaseLock = await acquireTerritoryMutationLock()
  try {
    const current = await listTerritories()
    const occupied = new Map(current.map((item) => [`${item.city}|${item.district}`, item]))
    const requested = new Set<string>()
    for (const item of data) {
      const key = `${item.city}|${item.district}`
      const conflict = occupied.get(key)
      if (conflict) throw new Error(`${item.city}${item.district} 已由 ${conflict.salesperson} 負責`)
      if (requested.has(key)) throw new Error(`${item.city}${item.district} 重複選取`)
      requested.add(key)
    }
    const created: Territory[] = []
    try {
      for (const item of data) created.push(await createTerritoryPage(item))
    } catch (error) {
      // 批次建立任一筆失敗時，逐筆重試封存；若仍有殘留，明確揭露 page IDs 供人工處理。
      const rollback = await Promise.allSettled(created.map((item) =>
        notionCallWithRetry('rollbackTerritoryBatch', () => notion.pages.update({ page_id: item.id, archived: true }))
      ))
      const residueIds = rollback.flatMap((result, index) => result.status === 'rejected' ? [created[index].id] : [])
      if (residueIds.length) {
        throw new Error(`批次建立失敗且部分回滾未完成；殘留轄區頁面：${residueIds.join('、')}；原始錯誤：${error instanceof Error ? error.message : String(error)}`)
      }
      throw error
    }
    return created
  } finally {
    await releaseLock()
  }
}

export async function createTerritory(data: CreateTerritoryInput): Promise<Territory> {
  return (await createTerritories([data]))[0]
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
