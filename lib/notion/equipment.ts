/**
 * lib/notion/equipment.ts — 客戶設備（從 system-notion.ts 抽出）
 * 含設備搜尋、客戶設備清單、單筆設備、更新，以及只供設備使用的 Notion 圖片解析 helper。
 */
import type { Equipment } from '@/types'
import {
  notion, DB, transientCache, normalizeDatabaseId, notionCallWithRetry,
  getCachedValue, setCachedValue,
  getProp, getTitle, getText, getSelect, getRelationIds, getRollupText,
} from './shared'

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

  setCachedValue(cacheKey, items, 120_000) // 2 min
  return items
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
  for (const b of blocks) {
    if (b.type === 'image') return getImageBlockUrl(b)
  }
  const containers = blocks.filter((b: any) => ['column_list', 'column'].includes(b.type))
  for (const container of containers) {
    try {
      const children: any = await notionCallWithRetry('resolvePageDetails:children', () =>
        notion.blocks.children.list({ block_id: container.id, page_size: 20 })
      )
      for (const child of children.results ?? []) {
        if (child.type === 'image') return getImageBlockUrl(child)
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
        let name = ''
        for (const val of Object.values(page.properties ?? {}) as any[]) {
          if (val.type === 'title') {
            name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
            break
          }
        }
        let thumbnail = getPageCoverUrl(page)
        if (!thumbnail) {
          thumbnail = await findFirstImageUrl(blocks.results ?? [])
        }
        const details = { thumbnail, name }
        result[id] = details
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

  if (results.length > 0) {
    const fields = Object.keys(results[0].properties ?? {})
    console.log('[equipment fields]', fields.join(', '))
  }

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

  setCachedValue(cacheKey, items, 180_000) // 3 min
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

    const getDateField = (field: string) => {
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
      warrantyEnd: getDateField('保固結束日期'),
      activationDate: getDateField('啟用日期'),
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
