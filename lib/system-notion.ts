import { Client } from '@notionhq/client'
import type { CreateTicketPayload, Equipment, Ticket } from '@/types'

export type ModuleSummary = {
  total: number
  recent: Array<{
    id: string
    title: string
    meta: string
    href?: string
  }>
}

export type DashboardSummary = {
  customers: ModuleSummary
  tickets: ModuleSummary
  opportunities: ModuleSummary
  products: ModuleSummary
  users: ModuleSummary
}

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const transientCache = new Map<string, { expiresAt: number; value: unknown }>()

const DB = {
  customers: process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? process.env.NOTION_CUSTOMERS_DB,
  visits: process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16',
  tickets:
    process.env.NOTION_TICKETS_SYSTEM_DB ??
    process.env.NOTION_TICKETS_DB ??
    '285dcdaa-fb2a-81d9-b434-f8c5c43d006b',
  opportunities:
    process.env.NOTION_OPPORTUNITIES_SYSTEM_DB ??
    process.env.NOTION_OPPORTUNITIES_DB ??
    'b1d7283f-d48c-49c3-836e-e6a6c0dab177',
  products: process.env.NOTION_PRODUCTS_SYSTEM_DB ?? process.env.NOTION_PRODUCTS_DB,
  users:
    process.env.NOTION_USERS_SYSTEM_DB ??
    process.env.NOTION_USERS_DB ??
    '24128750-c5eb-461c-b3db-20994ae14391',
  equipment:
    process.env.NOTION_EQUIPMENT_SYSTEM_DB ??
    process.env.NOTION_EQUIPMENT_DB ??
    '285dcdaa-fb2a-812d-a5ab-eb34d8008d43',
} as const

function normalizeDatabaseId(value?: string) {
  if (!value) return ''
  return value.replace('collection://', '')
}

function getProp(page: any, field: string) {
  return page.properties?.[field]
}

function getTitle(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''

  if (prop.type === 'title') {
    return prop.title?.map((item: any) => item.plain_text).join('') ?? ''
  }

  if (prop.type === 'rich_text') {
    return prop.rich_text?.map((item: any) => item.plain_text).join('') ?? ''
  }

  return ''
}

function getText(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''

  if (prop.type === 'rich_text') {
    return prop.rich_text?.map((item: any) => item.plain_text).join('') ?? ''
  }

  if (prop.type === 'email') return prop.email ?? ''
  if (prop.type === 'phone_number') return prop.phone_number ?? ''

  return ''
}

function getSelect(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'select') return prop.select?.name ?? ''
  if (prop.type === 'status') return prop.status?.name ?? ''
  return ''
}

function getNumber(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'number') return 0
  return prop.number ?? 0
}

function getDate(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'date') return ''
  return prop.date?.start ?? ''
}

function getRelationIds(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'relation') return [] as string[]
  return (prop.relation ?? []).map((item: any) => item.id).filter(Boolean)
}

function getRollupText(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'rollup') return ''
  const arr: any[] = prop.rollup?.array ?? []
  return arr
    .map((item: any) => {
      if (item.type === 'rich_text') return item.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
      if (item.type === 'select') return item.select?.name ?? ''
      if (item.type === 'title') return item.title?.map((t: any) => t.plain_text).join('') ?? ''
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

function richText(content: string) {
  return [{ type: 'text', text: { content } }]
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function notionCallWithRetry<T>(
  label: string,
  action: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error

      if (!isRateLimited(error) || attempt === maxAttempts) {
        throw error
      }

      const delayMs = attempt * 1200
      console.warn(`${label} rate limited, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`)
      await sleep(delayMs)
    }
  }

  throw lastError
}

function getCachedValue<T>(key: string) {
  const hit = transientCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    transientCache.delete(key)
    return null
  }
  return hit.value as T
}

function setCachedValue<T>(key: string, value: T, ttlMs: number) {
  transientCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

async function queryDatabase(databaseId: string | undefined, pageSize = 6) {
  if (!databaseId) return []
  const response: any = await notionCallWithRetry('queryDatabase', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(databaseId),
      page_size: pageSize,
    })
  )

  return response.results ?? []
}

// Single-call summary: one request returns both rows and approximate total.
// Avoids the separate countDatabase pagination which caused 10+ parallel API calls.
async function querySummary(databaseId: string | undefined, pageSize = 100): Promise<{ rows: any[]; total: number }> {
  if (!databaseId) return { rows: [], total: 0 }
  const response: any = await notionCallWithRetry('querySummary', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(databaseId),
      page_size: pageSize,
    })
  )
  const rows = response.results ?? []
  return { rows, total: rows.length }
}

async function getCustomersSummary(): Promise<ModuleSummary> {
  const { rows, total } = await querySummary(DB.customers)
  return {
    total,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '客戶名稱'),
      meta: [getSelect(page, '縣市'), getSelect(page, '客戶類型')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function listAllSystemCustomers(): Promise<{ id: string; name: string; city: string; type: string }[]> {
  if (!DB.customers) return []
  const cacheKey = 'all-system-customers'
  const cached = getCachedValue<{ id: string; name: string; city: string; type: string }[]>(cacheKey)
  if (cached) return cached

  const { rows } = await querySummary(DB.customers, 200)
  const items = rows.map((page: any) => ({
    id: page.id,
    name: getTitle(page, '客戶名稱'),
    city: getSelect(page, '縣市'),
    type: getSelect(page, '客戶類型'),
  })).filter((c: any) => c.name)

  setCachedValue(cacheKey, items, 300_000) // cache 5 min
  return items
}

async function getTicketsSummary(): Promise<ModuleSummary> {
  const { rows, total } = await querySummary(DB.tickets)
  return {
    total,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title:
        getTitle(page, '編號') ||
        getText(page, '案件標題') ||
        getText(page, '客戶單位') ||
        '未命名案件',
      meta: [getSelect(page, '狀態'), getSelect(page, '優先級')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getOpportunitiesSummary(): Promise<ModuleSummary> {
  const { rows, total } = await querySummary(DB.opportunities)
  return {
    total,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '商機名稱'),
      meta: [
        getText(page, '負責業務'),
        getSelect(page, '商機階段'),
        getDate(page, '下次跟進日'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getProductsSummary(): Promise<ModuleSummary> {
  const { rows, total } = await querySummary(DB.products)
  return {
    total,
    recent: rows.slice(0, 6).map((page: any) => ({
      id: page.id,
      title: getTitle(page, 'Name'),
      meta: [getSelect(page, '生產商'), getSelect(page, '分類')]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

async function getUsersSummary(): Promise<ModuleSummary> {
  const { rows, total } = await querySummary(DB.users, 50)
  return {
    total,
    recent: rows.slice(0, 20).map((page: any) => ({
      id: page.id,
      title: getTitle(page, '帳號名稱'),
      meta: [
        getText(page, '帳號代碼'),
        getSelect(page, '帳號類型'),
        getSelect(page, '狀態'),
      ]
        .filter(Boolean)
        .join('・'),
    })),
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const cached = getCachedValue<DashboardSummary>('dashboard:summary')
  if (cached) return cached

  const safe = async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn()
    } catch (error) {
      console.warn('dashboard summary warning:', error)
      return fallback
    }
  }

  const [customers, tickets, opportunities, products, users] = await Promise.all([
    safe(getCustomersSummary, { total: 0, recent: [] }),
    safe(getTicketsSummary, { total: 0, recent: [] }),
    safe(getOpportunitiesSummary, { total: 0, recent: [] }),
    safe(getProductsSummary, { total: 0, recent: [] }),
    safe(getUsersSummary, { total: 0, recent: [] }),
  ])

  const summary: DashboardSummary = { customers, tickets, opportunities, products, users }

  setCachedValue('dashboard:summary', summary, 60_000)
  return summary
}

export async function getModuleRecords(module: keyof DashboardSummary) {
  const summary = await getDashboardSummary()
  return summary[module]
}

export async function getRoleSummary() {
  const users = await getUsersSummary()

  const counters = users.recent.reduce(
    (acc, item) => {
      if (item.meta.includes('業務')) acc.sales += 1
      if (item.meta.includes('中央管理')) acc.admin += 1
      if (item.meta.includes('行政')) acc.ops += 1
      return acc
    },
    { sales: 0, admin: 0, ops: 0 }
  )

  return counters
}

export async function searchEquipment(query: string): Promise<Equipment[]> {
  if (!DB.equipment) return []
  const keyword = query.trim()
  const cacheKey = `equipment:${keyword || '*'}`.toLowerCase()
  const cached = getCachedValue<Equipment[]>(cacheKey)
  if (cached) return cached

  const response: any = await notionCallWithRetry('searchEquipment', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.equipment),
      page_size: 20,
      ...(keyword
        ? {
            filter: {
              or: [
                { property: '客戶單位', title: { contains: keyword } },
                { property: '序號', rich_text: { contains: keyword } },
                { property: 'Support ID', rich_text: { contains: keyword } },
                { property: 'TeamViewer ID', rich_text: { contains: keyword } },
              ],
            },
          }
        : {}),
    })
  )

  const items = (response.results ?? []).map((page: any) => ({
    id: page.id,
    customerName: getTitle(page, '客戶單位'),
    serialNumber: getText(page, '序號'),
    manufacturer: getSelect(page, '生產商'),
    status: getSelect(page, '產品狀態'),
    supportId: getText(page, 'Support ID'),
    teamViewerId: getText(page, 'TeamViewer ID'),
    productName: getRelationIds(page, '機型').length
      ? '已綁定產品'
      : getRelationIds(page, '機型（系統）').length
        ? '已綁定產品'
        : '',
    originalCustomerId: getRelationIds(page, '客戶')[0] ?? '',
    originalProductId: getRelationIds(page, '機型')[0] ?? '',
  }))

  setCachedValue(cacheKey, items, 20_000)
  return items
}

export type SystemCustomerDetail = {
  id: string
  name: string
  city: string
  district: string
  type: string
  status: string
  address: string
  phone: string
  taxId: string
  dentistCount: number
  technicianCount: number
  technicianTraineeCount: number
}

export async function getSystemCustomerById(id: string): Promise<SystemCustomerDetail | null> {
  try {
    const page: any = await notionCallWithRetry('getSystemCustomerById', () =>
      notion.pages.retrieve({ page_id: id })
    )
    return {
      id: page.id,
      name: getTitle(page, '客戶名稱'),
      city: getSelect(page, '縣市'),
      district: getSelect(page, '行政區') || getText(page, '行政區'),
      type: getSelect(page, '客戶類型'),
      status: getSelect(page, '機構狀態'),
      address: getText(page, '地址'),
      phone: page.properties?.['電話']?.phone_number ?? getText(page, '電話'),
      taxId: getText(page, '統一編號'),
      dentistCount: getNumber(page, '牙醫師數'),
      technicianCount: getNumber(page, '牙體技術師數'),
      technicianTraineeCount: getNumber(page, '牙體技術生數量'),
    }
  } catch {
    return null
  }
}

/** Extract the public URL from a Notion page cover (external or file). */
function getPageCoverUrl(page: any): string {
  const cover = page?.cover
  if (!cover) return ''
  if (cover.type === 'external') return cover.external?.url ?? ''
  if (cover.type === 'file') return cover.file?.url ?? ''
  return ''
}

/** Extract the URL from a Notion image block. */
function getImageBlockUrl(block: any): string {
  if (block?.type !== 'image') return ''
  const img = block.image
  if (img?.type === 'file') return img.file?.url ?? ''
  if (img?.type === 'external') return img.external?.url ?? ''
  return ''
}

/** Find first image URL in a list of blocks, checking one level of children for column layouts. */
async function findFirstImageUrl(blocks: any[]): Promise<string> {
  // Check top-level first
  for (const b of blocks) {
    if (b.type === 'image') return getImageBlockUrl(b)
  }
  // Check one level deep inside column_list / column blocks
  const containers = blocks.filter((b: any) => ['column_list', 'column'].includes(b.type))
  for (const container of containers) {
    try {
      const children: any = await notionCallWithRetry('resolvePageDetails:children', () =>
        notion.blocks.children.list({ block_id: container.id, page_size: 20 })
      )
      for (const child of children.results ?? []) {
        if (child.type === 'image') return getImageBlockUrl(child)
        // One more level (column inside column_list)
        if (child.type === 'column') {
          const grandchildren: any = await notionCallWithRetry('resolvePageDetails:grandchildren', () =>
            notion.blocks.children.list({ block_id: child.id, page_size: 20 })
          )
          for (const gc of grandchildren.results ?? []) {
            if (gc.type === 'image') return getImageBlockUrl(gc)
          }
        }
      }
    } catch { /* skip */ }
  }
  return ''
}

/** Batch-resolve cover image URLs and titles for a set of page IDs (cached 45 min).
 *  Thumbnail priority: page cover → first image block (including nested in columns). */
async function resolvePageDetails(ids: string[]): Promise<Record<string, { thumbnail: string; name: string }>> {
  const result: Record<string, { thumbnail: string; name: string }> = {}
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return result

  await Promise.all(
    unique.map(async (id) => {
      const cacheKey = `page-details:${id}`
      const cached = getCachedValue<{ thumbnail: string; name: string }>(cacheKey)
      if (cached !== null) { result[id] = cached; return }
      try {
        const [page, blocks]: [any, any] = await Promise.all([
          notionCallWithRetry('resolvePageDetails:page', () =>
            notion.pages.retrieve({ page_id: id })
          ),
          notionCallWithRetry('resolvePageDetails:blocks', () =>
            notion.blocks.children.list({ block_id: id, page_size: 20 })
          ),
        ])
        // Title: scan all properties for the title type
        let name = ''
        for (const val of Object.values(page.properties ?? {}) as any[]) {
          if (val.type === 'title') {
            name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
            break
          }
        }
        // Thumbnail: page cover first, then search image blocks (including nested columns)
        let thumbnail = getPageCoverUrl(page)
        if (!thumbnail) {
          thumbnail = await findFirstImageUrl(blocks.results ?? [])
        }
        const details = { thumbnail, name }
        result[id] = details
        // S3 signed URLs expire in ~1h; cache 45 min if found, 30 s if missing (retry soon)
        setCachedValue(cacheKey, details, thumbnail ? 2_700_000 : 30_000)
      } catch {
        result[id] = { thumbnail: '', name: '' }
      }
    })
  )
  return result
}

// Known relation field names that link equipment → customer (tried in order)
const EQUIPMENT_CUSTOMER_FIELDS = ['客戶名稱', '🏥 牙科單位資料', '客戶', '診所']

export async function listCustomerEquipment(customerId: string): Promise<Equipment[]> {
  if (!DB.equipment) return []
  const cacheKey = `customer-equipment:${customerId}`
  const cached = getCachedValue<Equipment[]>(cacheKey)
  if (cached) return cached

  // Try each possible relation field name until one succeeds
  let results: any[] = []
  for (const field of EQUIPMENT_CUSTOMER_FIELDS) {
    try {
      const response: any = await notionCallWithRetry('listCustomerEquipment', () =>
        notion.databases.query({
          database_id: normalizeDatabaseId(DB.equipment),
          page_size: 50,
          filter: { property: field, relation: { contains: customerId } },
        })
      )
      results = response.results ?? []
      break // success — stop trying
    } catch (e: any) {
      if (e?.code === 'validation_error') {
        console.warn(`listCustomerEquipment: field "${field}" not found, trying next…`)
        continue
      }
      throw e
    }
  }

  // Log available fields on first result for debugging
  if (results.length > 0) {
    const fields = Object.keys(results[0].properties ?? {})
    console.log('[equipment fields]', fields.join(', '))
  }

  // Batch-resolve thumbnails from 機型 relation pages
  const productIds = results.map((p: any) =>
    getRelationIds(p, '機型')[0] ?? getRelationIds(p, '產品')[0] ?? ''
  )
  const detailsMap = await resolvePageDetails(productIds)

  const items = results.map((page: any) => {
    const productId = getRelationIds(page, '機型')[0] ?? getRelationIds(page, '產品')[0] ?? ''
    const details = detailsMap[productId] ?? { thumbnail: '', name: '' }
    return {
      id: page.id,
      customerName: getTitle(page, '客戶單位') || getTitle(page, '設備名稱') || getTitle(page, 'Name'),
      serialNumber: getText(page, '序號') || getText(page, 'Serial Number'),
      manufacturer: getSelect(page, '生產商') || getSelect(page, '品牌') || getRollupText(page, '品牌'),
      status: getSelect(page, '產品狀態') || getSelect(page, '狀態'),
      supportId: getText(page, 'Support ID'),
      teamViewerId: getText(page, 'TeamViewer ID'),
      productName: details.name,
      originalCustomerId: customerId,
      originalProductId: productId,
      thumbnail: details.thumbnail,
    }
  })

  setCachedValue(cacheKey, items, 30_000)
  return items
}

export async function getEquipmentById(id: string) {
  try {
    const page: any = await notionCallWithRetry('getEquipmentById', () =>
      notion.pages.retrieve({ page_id: id })
    )
    const productId = getRelationIds(page, '機型')[0] ?? getRelationIds(page, '產品')[0] ?? ''
    const detailsMap = await resolvePageDetails(productId ? [productId] : [])
    const details = detailsMap[productId] ?? { thumbnail: '', name: '' }

    const getDate = (field: string) => {
      const prop = getProp(page, field)
      return prop?.type === 'date' ? (prop.date?.start ?? '') : ''
    }

    return {
      id: page.id,
      customerName: getTitle(page, '客戶單位') || getTitle(page, '設備名稱') || getTitle(page, 'Name'),
      serialNumber: getText(page, '序號') || getText(page, 'Serial Number'),
      manufacturer: getSelect(page, '生產商') || getSelect(page, '品牌'),
      status: getSelect(page, '產品狀態') || getSelect(page, '狀態'),
      supportId: getText(page, 'Support ID'),
      teamViewerId: getText(page, 'TeamViewer ID'),
      dongleSerial: getText(page, 'Dongle 序號'),
      note: getText(page, '備註'),
      warrantyEnd: getDate('保固結束日期'),
      activationDate: getDate('啟用日期'),
      productName: details.name,
      originalProductId: productId,
      thumbnail: details.thumbnail,
      customerId: getRelationIds(page, '客戶名稱')[0] ?? '',
    }
  } catch {
    return null
  }
}

export async function updateEquipment(id: string, data: {
  status?: string
  serialNumber?: string
  supportId?: string
  teamViewerId?: string
  dongleSerial?: string
  note?: string
  warrantyEnd?: string
  activationDate?: string
}) {
  const properties: any = {}
  if (data.status !== undefined)
    properties['產品狀態'] = { select: data.status ? { name: data.status } : null }
  if (data.serialNumber !== undefined)
    properties['序號'] = { rich_text: [{ text: { content: data.serialNumber } }] }
  if (data.supportId !== undefined)
    properties['Support ID'] = { rich_text: [{ text: { content: data.supportId } }] }
  if (data.teamViewerId !== undefined)
    properties['TeamViewer ID'] = { rich_text: [{ text: { content: data.teamViewerId } }] }
  if (data.dongleSerial !== undefined)
    properties['Dongle 序號'] = { rich_text: [{ text: { content: data.dongleSerial } }] }
  if (data.note !== undefined)
    properties['備註'] = { rich_text: [{ text: { content: data.note } }] }
  if (data.warrantyEnd !== undefined)
    properties['保固結束日期'] = { date: data.warrantyEnd ? { start: data.warrantyEnd } : null }
  if (data.activationDate !== undefined)
    properties['啟用日期'] = { date: data.activationDate ? { start: data.activationDate } : null }

  await notionCallWithRetry('updateEquipment', () =>
    notion.pages.update({ page_id: id, properties })
  )
  // Invalidate all customer-equipment and page-details cache entries
  Array.from(transientCache.keys()).forEach((key) => {
    if (key.startsWith('customer-equipment:') || key.startsWith('page-details:')) {
      transientCache.delete(key)
    }
  })
}

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

  setCachedValue(cacheKey, items, 30_000)
  return items
}

export type CustomerSearchResult = {
  id: string; name: string; city: string; district: string
  address: string; type: string; salesperson: string
}

export async function searchSystemCustomers(
  query: string,
  filters?: { city?: string; district?: string; salesperson?: string }
): Promise<CustomerSearchResult[]> {
  if (!DB.customers) return []
  const keyword = query.trim()
  const hasFilters = !!(filters?.city || filters?.district || filters?.salesperson)
  if (!keyword && !hasFilters) return []

  const cacheKey = `sys-customers:${keyword}:${JSON.stringify(filters ?? {})}`.toLowerCase()
  const cached = getCachedValue<CustomerSearchResult[]>(cacheKey)
  if (cached) return cached

  const clauses: any[] = []
  if (keyword) clauses.push({ property: '客戶名稱', title: { contains: keyword } })
  if (filters?.city) clauses.push({ property: '縣市', select: { equals: filters.city } })
  if (filters?.district) clauses.push({ property: '行政區', select: { equals: filters.district } })
  if (filters?.salesperson) clauses.push({ property: '負責業務', select: { equals: filters.salesperson } })

  const notionFilter = clauses.length === 1 ? clauses[0] : { and: clauses }

  const response: any = await notionCallWithRetry('searchSystemCustomers', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.customers!),
      page_size: 30,
      filter: notionFilter,
      sorts: [{ property: '客戶名稱', direction: 'ascending' }],
    })
  )

  const items: CustomerSearchResult[] = (response.results ?? []).map((page: any) => ({
    id: page.id,
    name: getTitle(page, '客戶名稱'),
    city: getSelect(page, '縣市'),
    district: getSelect(page, '行政區') || getText(page, '行政區'),
    address: getText(page, '地址'),
    type: getSelect(page, '客戶類型'),
    salesperson: getSelect(page, '負責業務'),
  }))

  setCachedValue(cacheKey, items, 30_000)
  return items
}

export async function getCustomerFilterOptions(): Promise<{
  cities: string[]; districts: string[]; salespersons: string[]
}> {
  if (!DB.customers) return { cities: [], districts: [], salespersons: [] }
  const cacheKey = 'customer-filter-options'
  const cached = getCachedValue<{ cities: string[]; districts: string[]; salespersons: string[] }>(cacheKey)
  if (cached) return cached
  try {
    const db: any = await notionCallWithRetry('getCustomerFilterOptions', () =>
      notion.databases.retrieve({ database_id: normalizeDatabaseId(DB.customers!) })
    )
    const opts = (propName: string): string[] =>
      (db.properties?.[propName]?.select?.options ?? []).map((o: any) => o.name).filter(Boolean)
    const result = {
      cities: opts('縣市'),
      districts: opts('行政區'),
      salespersons: opts('負責業務'),
    }
    setCachedValue(cacheKey, result, 300_000)
    return result
  } catch {
    return { cities: [], districts: [], salespersons: [] }
  }
}

export type ProductItem = {
  id: string
  name: string
  manufacturer: string    // 生產商
  productType: string     // 商品類型 (軟體/設備/材料/耗材)
  category: string        // 分類 (研磨機/鋯塊/…)
  price: number | null    // 價格
  salePrice: number | null // 優惠價
  notes: string           // 備註
  weight: number | null   // 重量 (kg)
  // Technical specs
  bendingStrength: string     // 彎曲強度
  transparency: string        // 材料透度
  sinteringTemp: string       // 燒結溫度
  bendingModulus: string      // 彎曲模數 (Mpa)
  flexuralStrength: string    // 抗彎強度 (MPa)
  tensileStrength: string     // 抗拉強度 (MPa)
  elongation: string          // 拉伸伸長率
  hardness: string            // 硬度
  workingDistance: string     // 工作距離
  fieldWidth: string          // 景寬
  fieldDepth: string          // 景深
}

function getProductNumber(page: any, field: string): number | null {
  const v = page.properties?.[field]?.number
  return v == null ? null : v
}

// Fetches all products (cached 60 s) and returns them; caller can filter client-side.
async function getAllProducts(): Promise<ProductItem[]> {
  if (!DB.products) return []
  const cacheKey = 'products:all'
  const cached = getCachedValue<ProductItem[]>(cacheKey)
  if (cached) return cached

  const response: any = await notionCallWithRetry('getAllProducts', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.products!),
      page_size: 100,
    })
  )

  const items = (response.results ?? []).map((page: any) => {
    // Title field is called 'Name' in this DB
    let name = ''
    for (const val of Object.values(page.properties ?? {}) as any[]) {
      if (val.type === 'title') {
        name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
        break
      }
    }
    return {
      id: page.id,
      name,
      manufacturer: getSelect(page, '生產商'),
      productType: getSelect(page, '商品類型'),
      category: getSelect(page, '分類'),
      price: getProductNumber(page, '價格'),
      salePrice: getProductNumber(page, '優惠價'),
      notes: getText(page, '備註'),
      weight: getProductNumber(page, '重量 (kg)'),
      bendingStrength: getText(page, '彎曲強度'),
      transparency: getText(page, '材料透度'),
      sinteringTemp: getText(page, '燒結溫度'),
      bendingModulus: getText(page, '彎曲模數 (Mpa)'),
      flexuralStrength: getText(page, '抗彎強度 (MPa)'),
      tensileStrength: getText(page, '抗拉強度 (MPa)'),
      elongation: getText(page, '拉伸伸長率'),
      hardness: getText(page, '硬度'),
      workingDistance: getText(page, '工作距離'),
      fieldWidth: getText(page, '景寬'),
      fieldDepth: getText(page, '景深'),
    }
  })

  setCachedValue(cacheKey, items, 60_000)
  return items
}

export async function searchProducts(query: string): Promise<ProductItem[]> {
  const all = await getAllProducts()
  const keyword = query.trim().toLowerCase()
  if (!keyword) return all
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.manufacturer.toLowerCase().includes(keyword) ||
      p.category.toLowerCase().includes(keyword) ||
      p.productType.toLowerCase().includes(keyword)
  )
}

export async function getProductCategories(): Promise<{ brands: string[]; types: string[] }> {
  const all = await getAllProducts()
  const brands = Array.from(new Set(all.map((p) => p.manufacturer).filter(Boolean))).sort() as string[]
  const types = Array.from(new Set(all.map((p) => p.productType).filter(Boolean))).sort() as string[]
  return { brands, types }
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

export async function listSystemTickets(): Promise<Ticket[]> {
  const cached = getCachedValue<Ticket[]>('tickets:list')
  if (cached) return cached

  const response: any = await notionCallWithRetry('listSystemTickets', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.tickets),
      page_size: 100,
      sorts: [{ property: '建立日期', direction: 'descending' }],
    })
  )

  const rawItems = (response.results ?? []).map(mapTicketPageRaw)
  const items = (await resolveTicketNames(rawItems)) as Ticket[]
  setCachedValue('tickets:list', items, 15_000)
  return items
}

export async function getSystemTicketById(id: string) {
  const cacheKey = `ticket:${id}`
  const cached = getCachedValue<Omit<ReturnType<typeof mapTicketPageRaw>, '_relId'>>(cacheKey)
  if (cached) return cached

  const page: any = await notionCallWithRetry('getSystemTicketById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  const [ticket] = await resolveTicketNames([mapTicketPageRaw(page)])
  setCachedValue(cacheKey, ticket, 30_000)
  return ticket
}

// ── visits ────────────────────────────────────────────────────

export type Visit = {
  id: string
  customerName: string   // 單位名稱
  date: string           // 日期
  salesperson: string    // 業務人員
  status: string         // 狀態 (拜訪性質)
  content: string        // 拜訪內容
  address: string        // 地址
  city: string           // 縣市
  district: string       // 鄉鎮市區
  tags: string[]         // 客戶標籤
}

let _visitFieldsEnsured = false
async function ensureVisitDbFields() {
  if (_visitFieldsEnsured) return
  try {
    await notion.databases.update({
      database_id: normalizeDatabaseId(DB.visits),
      properties: {
        縣市:   { rich_text: {} },
        鄉鎮市區: { rich_text: {} },
        拜訪性質: { select: {} },
      } as any,
    })
  } catch (e) {
    console.warn('ensureVisitDbFields warning:', e)
  }
  _visitFieldsEnsured = true
}

/** Returns a raw visit object with an extra _relId field for name resolution. */
function mapVisitPageRaw(page: any) {
  return {
    id: page.id,
    _relId: getRelationIds(page, '🏥 牙科單位資料')[0] ?? '',
    customerName: getTitle(page, '單位名稱'), // fallback if relation unresolved
    date: getDate(page, '日期'),
    salesperson: getSelect(page, '業務人員') || getText(page, '業務人員'),
    status: getSelect(page, '拜訪性質') || getSelect(page, '狀態'),
    content: getText(page, '拜訪內容'),
    address: getText(page, '地址'),
    city: getRollupText(page, '縣市') || getSelect(page, '縣市') || getText(page, '縣市'),
    district: getRollupText(page, '鄉鎮市區') || getSelect(page, '鄉鎮市區') || getText(page, '鄉鎮市區'),
    tags: (getProp(page, '客戶標籤')?.multi_select ?? []).map((t: any) => t.name).filter(Boolean),
  }
}

/** Batch-fetch customer names for a set of relation IDs (each result cached 5 min). */
async function resolveCustomerNames(relIds: string[]): Promise<Record<string, string>> {
  const nameMap: Record<string, string> = {}
  const unique = Array.from(new Set(relIds.filter(Boolean)))
  if (!unique.length) return nameMap

  await Promise.all(
    unique.map(async (id) => {
      const cacheKey = `customer-name:${id}`
      const cached = getCachedValue<string>(cacheKey)
      if (cached !== null) { nameMap[id] = cached; return }
      try {
        const page: any = await notionCallWithRetry('resolveCustomerName', () =>
          notion.pages.retrieve({ page_id: id })
        )
        const name = getTitle(page, '客戶名稱')
        nameMap[id] = name
        setCachedValue(cacheKey, name, 300_000)
      } catch {
        nameMap[id] = ''
      }
    })
  )
  return nameMap
}

export async function listVisits(options?: { customerName?: string; customerId?: string }): Promise<Visit[]> {
  const cacheKey = `visits:${options?.customerId ?? options?.customerName ?? '*'}`
  const cached = getCachedValue<Visit[]>(cacheKey)
  if (cached) return cached

  let filter: any
  if (options?.customerId) {
    filter = { property: '🏥 牙科單位資料', relation: { contains: options.customerId } }
  } else if (options?.customerName) {
    filter = { property: '單位名稱', title: { contains: options.customerName } }
  }

  const response: any = await notionCallWithRetry('listVisits', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.visits),
      page_size: 100,
      sorts: [{ property: '日期', direction: 'descending' }],
      ...(filter ? { filter } : {}),
    })
  )

  const rawItems = (response.results ?? []).map(mapVisitPageRaw)

  // Resolve customer names from the 🏥 牙科單位資料 relation
  const nameMap = await resolveCustomerNames(rawItems.map((v: ReturnType<typeof mapVisitPageRaw>) => v._relId))

  const items: Visit[] = rawItems.map((raw: ReturnType<typeof mapVisitPageRaw>) => {
    const { _relId, ...v } = raw
    return { ...v, customerName: (_relId && nameMap[_relId]) || v.customerName }
  })

  setCachedValue(cacheKey, items, 20_000)
  return items
}

export async function createVisit(data: {
  customerName: string
  date: string
  salesperson: string
  status: string
  content: string
  address: string
  city: string
  district: string
  customerId?: string
}): Promise<Visit> {
  await ensureVisitDbFields()

  const response: any = await notionCallWithRetry('createVisit', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.visits) },
      properties: {
        單位名稱: { title: richText(data.customerName) },
        ...(data.date ? { 日期: { date: { start: data.date } } } : {}),
        ...(data.salesperson ? { 業務人員: { select: { name: data.salesperson } } } : {}),
        ...(data.status ? { 拜訪性質: { select: { name: data.status } } } : {}),
        拜訪內容: { rich_text: richText(data.content) },
        地址: { rich_text: richText(data.address) },
        縣市: { rich_text: richText(data.city) },
        鄉鎮市區: { rich_text: richText(data.district) },
        ...(data.customerId
          ? { '🏥 牙科單位資料': { relation: [{ id: data.customerId }] } }
          : {}),
      } as any,
    })
  )

  // Invalidate all visit caches
  Array.from(transientCache.keys())
    .filter((k) => k.startsWith('visits:'))
    .forEach((k) => transientCache.delete(k))

  return {
    id: response.id,
    customerName: data.customerName,
    date: data.date,
    salesperson: data.salesperson,
    status: data.status,
    content: data.content,
    address: data.address,
    city: data.city,
    district: data.district,
  }
}

export async function updateVisit(id: string, data: {
  customerName?: string
  date?: string
  salesperson?: string
  status?: string
  content?: string
  address?: string
  city?: string
  district?: string
  customerId?: string
}): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.customerName !== undefined) properties['單位名稱'] = { title: richText(data.customerName) }
  if (data.date !== undefined) properties['日期'] = { date: { start: data.date } }
  if (data.salesperson !== undefined) properties['業務人員'] = { select: { name: data.salesperson } }
  if (data.status !== undefined) properties['拜訪性質'] = { select: { name: data.status } }
  if (data.content !== undefined) properties['拜訪內容'] = { rich_text: richText(data.content) }
  if (data.address !== undefined) properties['地址'] = { rich_text: richText(data.address) }
  if (data.city !== undefined) properties['縣市'] = { rich_text: richText(data.city) }
  if (data.district !== undefined) properties['鄉鎮市區'] = { rich_text: richText(data.district) }
  if (data.customerId !== undefined) properties['🏥 牙科單位資料'] = { relation: [{ id: data.customerId }] }

  await notionCallWithRetry('updateVisit', () =>
    notion.pages.update({ page_id: id, properties } as any)
  )
  Array.from(transientCache.keys())
    .filter((k) => k.startsWith('visits:'))
    .forEach((k) => transientCache.delete(k))
}

export async function deleteVisit(id: string): Promise<void> {
  await notionCallWithRetry('deleteVisit', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  Array.from(transientCache.keys())
    .filter((k) => k.startsWith('visits:'))
    .forEach((k) => transientCache.delete(k))
}

// ── accounts & permissions ────────────────────────────────────

export const MODULE_KEYS = ['crm', 'rma', 'bd', 'products', 'quote', 'accounts'] as const
export type ModuleKey = typeof MODULE_KEYS[number]
export type ModulePermission = { view: boolean; edit: boolean }
export type UserPermissions = Record<ModuleKey, ModulePermission>

export const MODULE_LABELS: Record<ModuleKey, string> = {
  crm:      'CRM',
  rma:      'RMA',
  bd:       'BD',
  products: '產品',
  quote:    '報價',
  accounts: '帳號權限',
}

const MODULE_NOTION_FIELDS: Record<ModuleKey, { view: string; edit: string }> = {
  crm:      { view: 'CRM檢視',  edit: 'CRM編輯' },
  rma:      { view: 'RMA檢視',  edit: 'RMA編輯' },
  bd:       { view: 'BD檢視',   edit: 'BD編輯' },
  products: { view: '產品檢視', edit: '產品編輯' },
  quote:    { view: '報價檢視', edit: '報價編輯' },
  accounts: { view: '帳號檢視', edit: '帳號編輯' },
}

export function allPermissions(): UserPermissions {
  const result = {} as UserPermissions
  for (const mod of MODULE_KEYS) result[mod] = { view: true, edit: true }
  return result
}

function getCheckbox(page: any, field: string): boolean {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'checkbox') return false
  return prop.checkbox === true
}

function mapUserPermissions(page: any): UserPermissions {
  const result = {} as UserPermissions
  for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
    result[mod as ModuleKey] = {
      view: getCheckbox(page, fields.view),
      edit: getCheckbox(page, fields.edit),
    }
  }
  return result
}

export type SystemUser = {
  id: string
  name: string
  username: string
  accountType: string
  status: string
  permissions: UserPermissions
}

let _userFieldsEnsured = false
async function ensureUserDbFields() {
  if (_userFieldsEnsured) return
  try {
    const permProps: Record<string, any> = { 密碼: { rich_text: {} } }
    for (const fields of Object.values(MODULE_NOTION_FIELDS)) {
      permProps[fields.view] = { checkbox: {} }
      permProps[fields.edit] = { checkbox: {} }
    }
    await notion.databases.update({
      database_id: normalizeDatabaseId(DB.users),
      properties: permProps as any,
    })
  } catch (e) {
    console.warn('ensureUserDbFields warning:', e)
  }
  _userFieldsEnsured = true
}

export async function getSystemUsers(): Promise<SystemUser[]> {
  const cacheKey = 'users:all'
  const cached = getCachedValue<SystemUser[]>(cacheKey)
  if (cached) return cached

  await ensureUserDbFields()

  const response: any = await notionCallWithRetry('getSystemUsers', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      page_size: 50,
    })
  )

  const items: SystemUser[] = (response.results ?? []).map((page: any) => ({
    id: page.id,
    name: getTitle(page, '帳號名稱'),
    username: getText(page, '帳號代碼'),
    accountType: getSelect(page, '帳號類型'),
    status: getSelect(page, '狀態'),
    permissions: mapUserPermissions(page),
  }))

  setCachedValue(cacheKey, items, 60_000)
  return items
}

export async function getSystemUserByCredentials(
  username: string,
  password: string
): Promise<(SystemUser & { password: string }) | null> {
  await ensureUserDbFields()
  const response: any = await notionCallWithRetry('getSystemUserByCredentials', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      filter: { property: '帳號代碼', rich_text: { equals: username } },
    })
  )
  for (const page of response.results ?? []) {
    const storedPw = getText(page, '密碼')
    if (storedPw === password) {
      return {
        id: page.id,
        name: getTitle(page, '帳號名稱'),
        username: getText(page, '帳號代碼'),
        accountType: getSelect(page, '帳號類型'),
        status: getSelect(page, '狀態'),
        password: storedPw,
        permissions: mapUserPermissions(page),
      }
    }
  }
  return null
}

export async function createSystemUser(data: {
  name: string
  username: string
  password: string
  accountType: string
  permissions: UserPermissions
}): Promise<void> {
  await ensureUserDbFields()
  const permProps: Record<string, any> = {}
  for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
    const p = data.permissions[mod as ModuleKey]
    permProps[fields.view] = { checkbox: p.view }
    permProps[fields.edit] = { checkbox: p.edit }
  }
  await notionCallWithRetry('createSystemUser', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.users) },
      properties: {
        帳號名稱: { title: richText(data.name) },
        帳號代碼: { rich_text: richText(data.username) },
        密碼: { rich_text: richText(data.password) },
        ...(data.accountType ? { 帳號類型: { select: { name: data.accountType } } } : {}),
        ...permProps,
      } as any,
    })
  )
  transientCache.delete('users:all')
}

export async function updateSystemUser(
  id: string,
  data: {
    name?: string
    password?: string
    accountType?: string
    status?: string
    permissions?: UserPermissions
  }
): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.name !== undefined) properties['帳號名稱'] = { title: richText(data.name) }
  if (data.password !== undefined) properties['密碼'] = { rich_text: richText(data.password) }
  if (data.accountType !== undefined) properties['帳號類型'] = { select: { name: data.accountType } }
  if (data.status !== undefined) properties['狀態'] = { select: { name: data.status } }
  if (data.permissions !== undefined) {
    for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
      const p = data.permissions[mod as ModuleKey]
      properties[fields.view] = { checkbox: p.view }
      properties[fields.edit] = { checkbox: p.edit }
    }
  }
  await notionCallWithRetry('updateSystemUser', () =>
    notion.pages.update({ page_id: id, properties } as any)
  )
  transientCache.delete('users:all')
}

export async function deleteSystemUser(id: string): Promise<void> {
  await notionCallWithRetry('deleteSystemUser', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  transientCache.delete('users:all')
}
