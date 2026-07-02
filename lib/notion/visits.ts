/**
 * lib/notion/visits.ts — 客情拜訪（葉領域，從 system-notion.ts 抽出）
 * 客戶/產品名稱解析走 ./relations（跨切面），不直接 import customers/products。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getRedisValue, setRedisValue, deleteRedisValue, richText,
  getProp, getTitle, getText, getSelect, getDate, getRelationIds, getRollupText,
} from './shared'
import { resolveCustomerInfo, resolveProductNames } from './relations'
import { INACTIVE_SALESPERSONS } from '@/lib/line-salesperson-map'

export type Visit = {
  id: string
  customerId: string           // Notion page ID of linked customer (🏥 牙科單位資料 relation)
  customerName: string
  date: string
  salesperson: string
  status: string               // 拜訪性質 (legacy, preserved but no longer shown in form)
  content: string
  address: string
  city: string
  district: string
  tags: string[]
  competitorEquipment: string[]
  interestedProducts: Array<{ id: string; name: string }>
  interactionType: string      // 互動類型
  interactionPurpose: string   // 互動目的
  customerReaction: string     // 客戶反應
  followUpAction: string       // 後續動作
  needsFollowUp: boolean       // 是否需追蹤
  nextFollowUpDate: string     // 下次追蹤日
  followUpDone: boolean        // 追蹤已結案（勾了才從待追蹤清單消失，跨月不遺失）
}

export type VisitListResult = {
  items: Visit[]
  hasMore: boolean
  nextCursor: string | null
}

export type VisitFormOptions = {
  salespersons: string[]
  statuses: string[]
  tagOptions: string[]
  competitorOptions: string[]
  interactionTypes: string[]
  interactionPurposes: string[]
  customerReactions: string[]
  products: Array<{ id: string; name: string }>
}

// ⚠️ ensureVisitDbFields 已停用：
// Notion databases.update 傳入任何 select:{} / multi_select:{} 都會清除既有選項，
// 並同步刪除所有紀錄上的對應值。所有欄位在 Notion 中已存在，不需要此函式。
async function ensureVisitDbFields() {
  // intentionally empty — do NOT call databases.update here
}

const VISIT_FORM_OPTIONS_CACHE_KEY = 'visit-form-options:v4'
const VISIT_FORM_OPTIONS_TTL = 10 * 60 * 1000 // 10 min

export async function getVisitFormOptions(): Promise<VisitFormOptions> {
  await ensureVisitDbFields()

  // Return from cache if available (L1 → L2)
  const cached = await getRedisValue<VisitFormOptions>(VISIT_FORM_OPTIONS_CACHE_KEY)
  if (cached) return cached

  try {
    // Read DB schema for salesperson / status options
    const database: any = await notionCallWithRetry('getVisitFormOptions', () =>
      notion.databases.retrieve({
        database_id: normalizeDatabaseId(DB.visits),
      })
    )

    const salespersonOptions =
      database.properties?.['業務人員']?.select?.options?.map((option: any) => option.name).filter(Boolean) ?? []
    const statusOptions =
      database.properties?.['拜訪性質']?.select?.options?.map((option: any) => option.name).filter(Boolean) ?? []

    // New select fields — read options directly from schema (user manages options in Notion UI)
    const interactionTypeOptions: string[] =
      database.properties?.['互動類型']?.select?.options?.map((o: any) => o.name).filter(Boolean) ?? []
    const interactionPurposeOptions: string[] =
      database.properties?.['互動目的']?.select?.options?.map((o: any) => o.name).filter(Boolean) ?? []
    const customerReactionOptions: string[] =
      database.properties?.['客戶反應']?.select?.options?.map((o: any) => o.name).filter(Boolean) ?? []

    // For multi_select fields (客戶標籤, 競品): collect options from both the DB schema
    // AND from actual record values, so we never miss a previously-used option.
    const schemaTagOptions: string[] =
      database.properties?.['客戶標籤']?.multi_select?.options?.map((o: any) => o.name).filter(Boolean) ?? []
    const schemaCompetitorOptions: string[] =
      database.properties?.['競品']?.multi_select?.options?.map((o: any) => o.name).filter(Boolean) ?? []

    const allTagsSet = new Set<string>(schemaTagOptions)
    const allCompetitorSet = new Set<string>(schemaCompetitorOptions)
    // Collect salesperson names from actual records (schema options may be empty)
    const allSalespersonSet = new Set<string>(salespersonOptions)

    // Paginate through all records to also collect values from actual data
    let cursor: string | undefined
    do {
      const response: any = await notionCallWithRetry('getVisitFormOptions-scan', () =>
        notion.databases.query({
          database_id: normalizeDatabaseId(DB.visits),
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        })
      )
      for (const page of response.results ?? []) {
        for (const item of getProp(page, '客戶標籤')?.multi_select ?? []) {
          if (item?.name) allTagsSet.add(item.name)
        }
        for (const item of getProp(page, '競品')?.multi_select ?? []) {
          if (item?.name) allCompetitorSet.add(item.name)
        }
        // Collect salesperson names from each record (covers select / rich_text / people fields)
        const spProp = getProp(page, '業務人員')
        let sp = ''
        if (spProp?.type === 'select') sp = spProp.select?.name ?? ''
        else if (spProp?.type === 'status') sp = spProp.status?.name ?? ''
        else if (spProp?.type === 'rich_text') sp = spProp.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
        else if (spProp?.type === 'people') sp = spProp.people?.[0]?.name ?? ''
        else if (spProp?.type === 'formula') sp = spProp.formula?.string ?? ''
        if (sp) allSalespersonSet.add(sp)
      }
      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
    } while (cursor)

    const result: VisitFormOptions = {
      salespersons: Array.from(allSalespersonSet).filter((s) => !INACTIVE_SALESPERSONS.has(s)).sort(),
      statuses: statusOptions,
      tagOptions: Array.from(allTagsSet).sort(),
      competitorOptions: Array.from(allCompetitorSet).sort(),
      interactionTypes: interactionTypeOptions,
      interactionPurposes: interactionPurposeOptions,
      customerReactions: customerReactionOptions,
      products: [],  // products are searched on-demand via /api/products/search
    }
    // Cache result (L1 + L2) — only cache if we got actual salesperson data;
    // if salespersons is empty something went wrong and we want to retry on next request.
    if (result.salespersons.length > 0) {
      await setRedisValue(VISIT_FORM_OPTIONS_CACHE_KEY, result, VISIT_FORM_OPTIONS_TTL)
    }
    return result
  } catch (error) {
    console.warn('getVisitFormOptions warning:', error)
    return {
      salespersons: [],
      statuses: [],
      tagOptions: [],
      competitorOptions: [],
      interactionTypes: [],
      interactionPurposes: [],
      customerReactions: [],
      products: [],
    }
  }
}

/** Returns a raw visit object with extra _relId / _productRelIds for name resolution. */
function mapVisitPageRaw(page: any) {
  return {
    id: page.id,
    _relId: getRelationIds(page, '🏥 牙科單位資料')[0] ?? '',
    _productRelIds: getRelationIds(page, '有興趣的產品'),
    customerName: getTitle(page, '單位名稱'),
    date: getDate(page, '日期'),
    salesperson: getSelect(page, '業務人員') || getText(page, '業務人員'),
    status: getSelect(page, '拜訪性質') || getSelect(page, '狀態'), // legacy field
    content: getText(page, '拜訪內容'),
    address: getText(page, '地址'),
    city: getRollupText(page, '縣市') || getSelect(page, '縣市') || getText(page, '縣市'),
    district: getRollupText(page, '鄉鎮市區') || getSelect(page, '鄉鎮市區') || getText(page, '鄉鎮市區'),
    tags: (getProp(page, '客戶標籤')?.multi_select ?? []).map((t: any) => t.name).filter(Boolean),
    competitorEquipment: (getProp(page, '競品')?.multi_select ?? []).map((t: any) => t.name).filter(Boolean),
    interactionType: getSelect(page, '互動類型'),
    interactionPurpose: getSelect(page, '互動目的'),
    customerReaction: getSelect(page, '客戶反應'),
    followUpAction: getText(page, '後續動作'),
    needsFollowUp: getProp(page, '是否需追蹤')?.checkbox ?? false,
    nextFollowUpDate: getDate(page, '下次追蹤日'),
    followUpDone: getProp(page, '追蹤已結案')?.checkbox ?? false,
  }
}

// Cache for the first page of visits (no filters, no cursor) — v2 = page size 10
const VISITS_PAGE1_CACHE_KEY = 'visits:page1:v2'
const VISITS_PAGE1_TTL = 2 * 60 * 1000 // 2 minutes

function invalidateVisitsCache() {
  deleteRedisValue(VISITS_PAGE1_CACHE_KEY)
}

/** Resolve names and build final Visit[] from raw mapped items. */
async function buildVisitItems(rawItems: ReturnType<typeof mapVisitPageRaw>[]): Promise<Visit[]> {
  // 解析所有有 relation 的記錄（不限於 customerName 為空者）
  // 理由：匯入時可能同時存有手打名稱和 relation，應以 CRM 名稱和縣市為準
  const allRelIds = rawItems.filter((v) => v._relId).map((v) => v._relId)
  const infoMap = allRelIds.length ? await resolveCustomerInfo(allRelIds) : {}

  const allProductRelIds = rawItems.flatMap((v) => v._productRelIds)
  const productNameMap = allProductRelIds.length ? await resolveProductNames(allProductRelIds) : {}

  return rawItems.map((raw) => {
    const { _relId, _productRelIds, ...v } = raw
    const crmInfo = _relId ? infoMap[_relId] : null
    return {
      ...v,
      customerId: _relId,
      // 有 relation 時以 CRM 正式名稱為主，無 relation 才用手打名稱
      customerName: crmInfo?.name || v.customerName || '',
      // 有 relation 時以 CRM 縣市為主，無 relation 才用紀錄本身的縣市
      city:     crmInfo?.city     || v.city     || '',
      district: crmInfo?.district || v.district || '',
      interestedProducts: _productRelIds
        .map((pid: string) => ({ id: pid, name: productNameMap[pid] ?? '' }))
        .filter((p: { id: string; name: string }) => p.name),
    }
  })
}

/**
 * List visits with optional server-side filters and cursor-based pagination.
 */
export async function listVisits(options?: {
  customerName?: string
  customerId?: string
  salesperson?: string
  dateFrom?: string   // ISO date string, e.g. '2026-05-01'
  dateTo?: string     // ISO date string, e.g. '2026-05-31'
  cursor?: string
  limit?: number
  fetchAll?: boolean
}): Promise<VisitListResult> {
  const isFirstPage =
    !options?.customerName &&
    !options?.customerId &&
    !options?.salesperson &&
    !options?.cursor &&
    !options?.fetchAll

  // Return cached first page instantly if available (L1 → L2)
  if (isFirstPage) {
    const cached = await getRedisValue<VisitListResult>(VISITS_PAGE1_CACHE_KEY)
    if (cached) return cached
  }

  // Build Notion filter
  const filters: any[] = []
  if (options?.customerId) {
    filters.push({ property: '🏥 牙科單位資料', relation: { contains: options.customerId } })
  } else if (options?.customerName) {
    filters.push({ property: '單位名稱', title: { contains: options.customerName } })
  }
  if (options?.salesperson) {
    filters.push({ property: '業務人員', select: { equals: options.salesperson } })
  }
  if (options?.dateFrom) {
    filters.push({ property: '日期', date: { on_or_after: options.dateFrom } })
  }
  if (options?.dateTo) {
    filters.push({ property: '日期', date: { on_or_before: options.dateTo } })
  }
  const filter = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { and: filters }

  // ── fetchAll: paginate through every page (used by customer detail) ─────────
  if (options?.fetchAll) {
    const allResults: any[] = []
    let cur: string | undefined
    do {
      const response: any = await notionCallWithRetry('listVisits-all', () =>
        notion.databases.query({
          database_id: normalizeDatabaseId(DB.visits),
          page_size: 100,
          sorts: [{ property: '日期', direction: 'descending' }],
          ...(filter ? { filter } : {}),
          ...(cur ? { start_cursor: cur } : {}),
        })
      )
      allResults.push(...(response.results ?? []))
      cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
    } while (cur)

    const items = await buildVisitItems(allResults.map(mapVisitPageRaw))
    return { items, hasMore: false, nextCursor: null }
  }

  // ── Single-page query (the normal paginated path) ───────────────────────────
  const limit = options?.limit ?? 10
  const response: any = await notionCallWithRetry('listVisits', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.visits),
      page_size: limit,
      sorts: [{ property: '日期', direction: 'descending' }],
      ...(filter ? { filter } : {}),
      ...(options?.cursor ? { start_cursor: options.cursor } : {}),
    })
  )

  const rawItems = (response.results ?? []).map(mapVisitPageRaw)
  const items = await buildVisitItems(rawItems)

  const result: VisitListResult = {
    items,
    hasMore: response.has_more ?? false,
    nextCursor: response.next_cursor ?? null,
  }

  // Cache only the first page (no filters, no cursor)
  if (isFirstPage) {
    await setRedisValue(VISITS_PAGE1_CACHE_KEY, result, VISITS_PAGE1_TTL)
  }

  return result
}

export async function getVisitById(id: string): Promise<Visit> {
  const page: any = await notionCallWithRetry('getVisitById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  const raw = mapVisitPageRaw(page)
  const [infoMap, productNameMap] = await Promise.all([
    resolveCustomerInfo(raw._relId ? [raw._relId] : []),
    resolveProductNames(raw._productRelIds),
  ])
  const { _relId, _productRelIds, ...visit } = raw
  const crmInfo = _relId ? infoMap[_relId] : null

  return {
    ...visit,
    customerId:   _relId,
    customerName: crmInfo?.name     || visit.customerName,
    city:         crmInfo?.city     || visit.city     || '',
    district:     crmInfo?.district || visit.district || '',
    interestedProducts: (_productRelIds as string[])
      .map((pid: string) => ({ id: pid, name: productNameMap[pid] ?? '' }))
      .filter((p: { id: string; name: string }) => p.name),
  }
}

export async function createVisit(data: {
  customerName: string
  date: string
  salesperson: string
  status?: string
  content: string
  address: string
  city: string
  district: string
  customerId?: string
  tags?: string[]
  competitorEquipment?: string[]
  interestedProductIds?: string[]
  interactionType?: string
  interactionPurpose?: string
  customerReaction?: string
  followUpAction?: string
  needsFollowUp?: boolean
  nextFollowUpDate?: string
}): Promise<Visit> {
  invalidateVisitsCache()
  await ensureVisitDbFields()

  const response: any = await notionCallWithRetry('createVisit', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.visits) },
      properties: {
        單位名稱: { title: richText(data.customerName) },
        ...(data.date ? { 日期: { date: { start: data.date } } } : {}),
        ...(data.salesperson ? { 業務人員: { select: { name: data.salesperson } } } : {}),
        拜訪內容: { rich_text: richText(data.content) },
        地址: { rich_text: richText(data.address) },
        縣市: { rich_text: richText(data.city) },
        鄉鎮市區: { rich_text: richText(data.district) },
        ...(data.tags?.length
          ? { 客戶標籤: { multi_select: data.tags.map((name) => ({ name })) } }
          : {}),
        ...(data.competitorEquipment?.length
          ? { 競品: { multi_select: data.competitorEquipment.map((name) => ({ name })) } }
          : {}),
        ...(data.customerId
          ? { '🏥 牙科單位資料': { relation: [{ id: data.customerId }] } }
          : {}),
        ...(data.interestedProductIds?.length
          ? { '有興趣的產品': { relation: data.interestedProductIds.map((id) => ({ id })) } }
          : {}),
        ...(data.interactionType ? { 互動類型: { select: { name: data.interactionType } } } : {}),
        ...(data.interactionPurpose ? { 互動目的: { select: { name: data.interactionPurpose } } } : {}),
        ...(data.customerReaction ? { 客戶反應: { select: { name: data.customerReaction } } } : {}),
        ...(data.followUpAction ? { 後續動作: { rich_text: richText(data.followUpAction) } } : {}),
        是否需追蹤: { checkbox: data.needsFollowUp ?? false },
        ...(data.nextFollowUpDate ? { 下次追蹤日: { date: { start: data.nextFollowUpDate } } } : {}),
      } as any,
    })
  )

  return {
    id: response.id,
    customerId: data.customerId ?? '',
    customerName: data.customerName,
    date: data.date,
    salesperson: data.salesperson,
    status: data.status ?? '',
    content: data.content,
    address: data.address,
    city: data.city,
    district: data.district,
    tags: data.tags ?? [],
    competitorEquipment: data.competitorEquipment ?? [],
    interestedProducts: [],
    interactionType: data.interactionType ?? '',
    interactionPurpose: data.interactionPurpose ?? '',
    customerReaction: data.customerReaction ?? '',
    followUpAction: data.followUpAction ?? '',
    needsFollowUp: data.needsFollowUp ?? false,
    nextFollowUpDate: data.nextFollowUpDate ?? '',
    followUpDone: false,
  }
}

/**
 * 跨月列出所有「未結案」的待追蹤拜訪（是否需追蹤=true 且 追蹤已結案=false）。
 * 修復舊版只算本月、月初整批消失的缺陷。有追蹤日者在前（升冪），無日期者在後。
 */
export async function listOpenFollowUps(): Promise<Visit[]> {
  const allResults: any[] = []
  let cur: string | undefined
  do {
    const response: any = await notionCallWithRetry('listOpenFollowUps', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        filter: {
          and: [
            { property: '是否需追蹤', checkbox: { equals: true } },
            { property: '追蹤已結案', checkbox: { equals: false } },
          ],
        },
        sorts: [{ property: '日期', direction: 'descending' }],
        ...(cur ? { start_cursor: cur } : {}),
      })
    )
    allResults.push(...(response.results ?? []))
    cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cur)

  const items = await buildVisitItems(allResults.map(mapVisitPageRaw))
  return items.sort((a, b) => {
    if (a.nextFollowUpDate && !b.nextFollowUpDate) return -1
    if (!a.nextFollowUpDate && b.nextFollowUpDate) return 1
    return (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? '')
  })
}

/** 結案一筆追蹤（可逆：Notion 勾選框取消即可復原，無資料遺失） */
export async function closeFollowUp(id: string): Promise<void> {
  invalidateVisitsCache()
  await notionCallWithRetry('closeFollowUp', () =>
    notion.pages.update({ page_id: id, properties: { '追蹤已結案': { checkbox: true } } as any })
  )
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
  tags?: string[]
  competitorEquipment?: string[]
  interestedProductIds?: string[]
  interactionType?: string
  interactionPurpose?: string
  customerReaction?: string
  followUpAction?: string
  needsFollowUp?: boolean
  nextFollowUpDate?: string
  followUpDone?: boolean
}): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.customerName !== undefined) properties['單位名稱'] = { title: richText(data.customerName) }
  // ⚠️ date / salesperson 不能傳空值給 Notion（select 空名稱、date 空字串均會 400）
  if (data.date !== undefined) {
    properties['日期'] = data.date ? { date: { start: data.date } } : { date: null }
  }
  if (data.salesperson !== undefined) {
    properties['業務人員'] = data.salesperson ? { select: { name: data.salesperson } } : { select: null }
  }
  if (data.content !== undefined) properties['拜訪內容'] = { rich_text: richText(data.content) }
  if (data.address !== undefined) properties['地址'] = { rich_text: richText(data.address) }
  if (data.city !== undefined) properties['縣市'] = { rich_text: richText(data.city) }
  if (data.district !== undefined) properties['鄉鎮市區'] = { rich_text: richText(data.district) }
  if (data.tags !== undefined) properties['客戶標籤'] = { multi_select: data.tags.map((name) => ({ name })) }
  if (data.competitorEquipment !== undefined) properties['競品'] = { multi_select: data.competitorEquipment.map((name) => ({ name })) }
  if (data.interestedProductIds !== undefined) properties['有興趣的產品'] = { relation: data.interestedProductIds.map((id) => ({ id })) }
  if (data.customerId !== undefined) {
    properties['🏥 牙科單位資料'] = data.customerId
      ? { relation: [{ id: data.customerId }] }
      : { relation: [] }
  }
  if (data.interactionType !== undefined) properties['互動類型'] = data.interactionType ? { select: { name: data.interactionType } } : { select: null }
  if (data.interactionPurpose !== undefined) properties['互動目的'] = data.interactionPurpose ? { select: { name: data.interactionPurpose } } : { select: null }
  if (data.customerReaction !== undefined) properties['客戶反應'] = data.customerReaction ? { select: { name: data.customerReaction } } : { select: null }
  if (data.followUpAction !== undefined) properties['後續動作'] = { rich_text: richText(data.followUpAction) }
  if (data.needsFollowUp !== undefined) properties['是否需追蹤'] = { checkbox: data.needsFollowUp }
  if (data.nextFollowUpDate !== undefined) properties['下次追蹤日'] = data.nextFollowUpDate ? { date: { start: data.nextFollowUpDate } } : { date: null }
  if (data.followUpDone !== undefined) properties['追蹤已結案'] = { checkbox: data.followUpDone }

  invalidateVisitsCache()
  await notionCallWithRetry('updateVisit', () =>
    notion.pages.update({ page_id: id, properties } as any)
  )
}

export async function deleteVisit(id: string): Promise<void> {
  invalidateVisitsCache()
  await notionCallWithRetry('deleteVisit', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
}
