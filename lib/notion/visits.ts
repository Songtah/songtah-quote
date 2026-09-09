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
        // ⚠️ 不要寫「縣市」「鄉鎮市區」——客情資料庫沒有這兩個屬性（ensureVisitDbFields 已依
        // 「GET 禁止改 schema」鐵則清空，欄位在 Notion 端被移除後就不再存在）。
        // 寫了會讓整個 pages.create 回 400「縣市 is not a property that exists.」，
        // 而 LINE webhook 的 try/catch 會靜默吞掉——實際造成 2026-09-01～09-09 共 8 天
        // 完全沒有任何客情紀錄進入系統。縣市/行政區一律由客戶 relation 解析（見 buildVisitItems）。
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
/** 狀態欄的 Complete 群組：落在這裡就不是待辦 */
const FOLLOW_UP_COMPLETE_STATUS = new Set(['結案', '沒興趣'])

export async function listOpenFollowUps(salesperson?: string): Promise<Visit[]> {
  const allResults: any[] = []
  let cur: string | undefined
  do {
    const response: any = await notionCallWithRetry('listOpenFollowUps', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        filter: {
          and: [
            { property: '追蹤已結案', checkbox: { equals: false } },
            // 兩套表達合一：checkbox 與 status 欄各自獨立演進，
            // 導致 388 筆狀態「追蹤中」的紀錄從來沒出現在待追蹤清單裡（實測兩者完全不重疊）。
            // 這裡一次收兩種來源，Complete 群組（結案／沒興趣）由下方過濾掉。
            {
              or: [
                { property: '是否需追蹤', checkbox: { equals: true } },
                { property: '狀態', status: { equals: '追蹤中' } },
              ],
            },
            ...(salesperson
              ? [{ property: '業務人員', select: { equals: salesperson } }]
              : []),
          ],
        },
        sorts: [{ property: '日期', direction: 'descending' }],
        ...(cur ? { start_cursor: cur } : {}),
      })
    )
    allResults.push(...(response.results ?? []))
    cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cur)

  // 狀態欄已落在 Complete 群組者不算待辦（結案／沒興趣）
  const active = allResults.filter((page: any) =>
    !FOLLOW_UP_COMPLETE_STATUS.has(page.properties?.['狀態']?.status?.name ?? ''))

  const items = await buildVisitItems(active.map(mapVisitPageRaw))

  // 待辦掛在「客戶」上而非「單筆拜訪」上：同一客戶只留最新一筆。
  // 掛事件會重複——實測 700 筆去重後只有 422 家客戶，其中 126 家被標了多筆
  // （永信牙醫 11 筆、瑪騰牙體技術所 8 筆），業務看到的是同一件事被列很多次。
  const byCustomer = new Map<string, Visit>()
  for (const item of items) {
    const key = `${item.salesperson}|${item.customerId || item.customerName}`
    const kept = byCustomer.get(key)
    if (!kept || (item.date ?? '') > (kept.date ?? '')) byCustomer.set(key, item)
  }

  // 有到期日的排前面（升冪，最急的在最上），沒有到期日的按拜訪日由新到舊墊底
  return Array.from(byCustomer.values()).sort((a, b) => {
    if (a.nextFollowUpDate && !b.nextFollowUpDate) return -1
    if (!a.nextFollowUpDate && b.nextFollowUpDate) return 1
    if (a.nextFollowUpDate && b.nextFollowUpDate) {
      return a.nextFollowUpDate.localeCompare(b.nextFollowUpDate)
    }
    return (b.date ?? '').localeCompare(a.date ?? '')
  })
}

/**
 * 自動結案陳舊的待追蹤（每晚排程呼叫）。
 *
 * 為什麼要有這支：唯一的結案方式是人回頭勾「追蹤已結案」，而實測結案率 **0.0%**
 * （700 筆標記、0 筆結案）。同時 700 筆裡有 413 筆的客戶其實早已再次拜訪——
 * 事情做完了，只是沒人回來勾。依 CLAUDE.md 自動化鐵則：狀態必須能自己關閉。
 *
 * 三條結案條件（前兩條是「已經有後續事件發生」的客觀證據；第三條是時效）：
 *   A. 同一客戶有日期更新的拜訪紀錄 → 這筆的後續已被新的互動取代
 *   B. 該筆的「狀態」欄已是 結案／沒興趣 → 兩套表達合一（狀態欄的 Complete 群組）
 *   C. 距拜訪日超過 STALE_FOLLOW_UP_DAYS 天 → 逾期歸檔
 *
 * 為什麼 C 用「拜訪日」當基準：命中 A 的都已經先被關掉了，所以還留著的這批，
 * 拜訪日就是該客戶最後一次有動靜的時間。超過 90 天沒有任何互動的跟進，
 * 實務上已經沒有意義，留著只會稀釋掉真正該打電話的那批
 * （實測 369 筆裡有 115 筆超過半年、1 筆 609 天且業務已離職）。
 *
 * 可逆：只勾 checkbox，取消勾選即復原，無資料遺失。
 */

/** 逾期歸檔門檻（天）。2026-09-09 使用者採 90 天：91–180 天區間本已冷卻，
 *  而 120 天只比 90 天多留 10 筆，不值得為此拉長標準。 */
export const STALE_FOLLOW_UP_DAYS = 90
export type FollowUpAutoCloseResult = {
  scanned: number
  open: number
  closed: number
  byReason: { newerVisit: number; statusComplete: number; staleAge: number }
  samples: { customerName: string; salesperson: string; date: string; reason: string }[]
}

export async function autoCloseStaleFollowUps(
  options: { dryRun?: boolean } = {}
): Promise<FollowUpAutoCloseResult> {
  const dryRun = options.dryRun !== false   // 預設 dry-run，要明確傳 false 才會寫入

  type Row = { id: string; name: string; sp: string; date: string; need: boolean; done: boolean; status: string }
  const rows: Row[] = []
  let cur: string | undefined
  do {
    const response: any = await notionCallWithRetry('autoCloseStaleFollowUps:scan', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        ...(cur ? { start_cursor: cur } : {}),
      })
    )
    for (const page of response.results ?? []) {
      rows.push({
        id: page.id,
        name: getTitle(page, '單位名稱'),
        sp: getSelect(page, '業務人員') || getText(page, '業務人員'),
        date: getDate(page, '日期'),
        need: page.properties?.['是否需追蹤']?.checkbox ?? false,
        done: page.properties?.['追蹤已結案']?.checkbox ?? false,
        status: page.properties?.['狀態']?.status?.name ?? '',
      })
    }
    cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cur)

  // 每個客戶的最新拜訪日
  const latestByCustomer = new Map<string, string>()
  for (const r of rows) {
    if (!r.name || !r.date) continue
    if ((latestByCustomer.get(r.name) ?? '') < r.date) latestByCustomer.set(r.name, r.date)
  }

  // 待辦的定義與 listOpenFollowUps 一致：checkbox 或 狀態=追蹤中，且尚未結案
  const open = rows.filter((r) => !r.done && (r.need || r.status === '追蹤中'))
  const staleBefore = new Date(Date.now() - STALE_FOLLOW_UP_DAYS * 864e5).toISOString().slice(0, 10)
  const toClose: { row: Row; reason: 'newerVisit' | 'statusComplete' | 'staleAge' }[] = []
  for (const r of open) {
    if (FOLLOW_UP_COMPLETE_STATUS.has(r.status)) { toClose.push({ row: r, reason: 'statusComplete' }); continue }
    const latest = latestByCustomer.get(r.name) ?? ''
    if (r.date && latest > r.date) { toClose.push({ row: r, reason: 'newerVisit' }); continue }
    if (r.date && r.date < staleBefore) toClose.push({ row: r, reason: 'staleAge' })
  }

  if (!dryRun) {
    for (const item of toClose) {
      // 兩套表達一起收斂：只勾 checkbox 會讓「狀態」停在追蹤中，等於又留下兩種說法。
      // 狀態原本是 追蹤中 的，一併移到 Complete 群組。
      const properties: any = { '追蹤已結案': { checkbox: true } }
      if (item.row.status === '追蹤中') properties['狀態'] = { status: { name: '結案' } }
      await notionCallWithRetry('autoCloseStaleFollowUps:close', () =>
        notion.pages.update({ page_id: item.row.id, properties })
      )
    }
  }

  return {
    scanned: rows.length,
    open: open.length,
    closed: toClose.length,
    byReason: {
      newerVisit: toClose.filter((t) => t.reason === 'newerVisit').length,
      statusComplete: toClose.filter((t) => t.reason === 'statusComplete').length,
      staleAge: toClose.filter((t) => t.reason === 'staleAge').length,
    },
    samples: toClose.slice(0, 10).map((t) => ({
      customerName: t.row.name, salesperson: t.row.sp, date: t.row.date,
      reason: t.reason === 'newerVisit' ? `該客戶最新拜訪 ${latestByCustomer.get(t.row.name)}`
        : t.reason === 'staleAge' ? `距今超過 ${STALE_FOLLOW_UP_DAYS} 天無互動`
        : `狀態已是「${t.row.status}」`,
    })),
  }
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
  // 「縣市」「鄉鎮市區」不存在於客情資料庫，寫入會讓整筆更新 400——見 createVisit 的說明。
  // 編輯表單是整包 JSON.stringify(form) 送出、必帶這兩個鍵，所以編輯儲存必然失敗。
  // 兩者由客戶 relation 解析，這裡刻意忽略。
  // 「狀態」原本宣告在型別裡卻從未寫入，等於使用者改了也不會存——一併補上（status 型別）。
  if (data.status !== undefined) {
    properties['狀態'] = data.status ? { status: { name: data.status } } : { status: null }
  }
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

/**
 * 全掃拜訪庫,回傳 customerId(去連字號)→最後拜訪日(YYYY-MM-DD)。
 * 供拜訪建議快取層(組合層 visit-suggestions)每晚重算;不要在請求路徑直接呼叫。
 * 現量 ~4.8k 筆;接近 10k 靜默截斷上限時需改分區掃描(鐵則 #0)。
 */
export async function scanVisitRecency(): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  let total = 0
  let cur: string | undefined
  do {
    const response: any = await notionCallWithRetry('scanVisitRecency', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        ...(cur ? { start_cursor: cur } : {}),
      })
    )
    for (const page of response.results ?? []) {
      total++
      const relId = ((page.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id as string) ?? '').replace(/-/g, '')
      if (!relId) continue
      const date = page.properties?.['日期']?.date?.start ?? ''
      if (!date) continue
      if (!map[relId] || date > map[relId]) map[relId] = date
    }
    cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cur)
  if (total >= 9500) console.warn(`scanVisitRecency: 拜訪庫已達 ${total} 筆,逼近 Notion 10k 截斷上限,須改分區掃描`)
  return map
}

/**
 * 全掃拜訪庫，回傳 customerId(去連字號) → 各業務對這家的回報次數與最後回報日。
 *
 * 供組合層 visit-claim 判定「這是支援還是在開發」——次數是兩者的分界線
 * （實測轄區外未認領的 239 組裡，192 組只回報過 1 次），
 * 而「有幾位不同業務拜訪過」是歸屬爭議的訊號。
 * 與 scanVisitRecency 一樣是全掃，走快取層每晚重算，不要在請求路徑直接呼叫。
 */
export type VisitClaimSignal = { visitors: Record<string, number>; lastDate: string }

export async function scanVisitClaimSignals(): Promise<Record<string, VisitClaimSignal>> {
  const map: Record<string, VisitClaimSignal> = {}
  let total = 0
  let cur: string | undefined
  do {
    const response: any = await notionCallWithRetry('scanVisitClaimSignals', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        ...(cur ? { start_cursor: cur } : {}),
      })
    )
    for (const page of response.results ?? []) {
      total++
      const relId = ((page.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id as string) ?? '').replace(/-/g, '')
      if (!relId) continue
      const who = getSelect(page, '業務人員') || getText(page, '業務人員')
      if (!who) continue
      const date = getDate(page, '日期')
      const hit = map[relId] ?? (map[relId] = { visitors: {}, lastDate: '' })
      hit.visitors[who] = (hit.visitors[who] ?? 0) + 1
      if (date > hit.lastDate) hit.lastDate = date
    }
    cur = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cur)
  if (total >= 9500) console.warn(`scanVisitClaimSignals: 拜訪庫已達 ${total} 筆,逼近 Notion 10k 截斷上限,須改分區掃描`)
  return map
}

/**
 * 輕量拜訪計次：只取「日期＋業務人員」，不解析客戶 relation。
 *
 * listVisits({ fetchAll }) 會為每筆解析客戶與產品 relation，做團隊年度統計
 * （數千筆）時會嚴重拖慢甚至逾時。業績統計只需要按日期與業務分組計次，
 * 因此另開這支跳過 relation 解析。
 */
export async function listVisitTallies(
  from: string, to: string, salesperson?: string,
): Promise<{ date: string; salesperson: string }[]> {
  const filters: any[] = [
    { property: '日期', date: { on_or_after: from } },
    { property: '日期', date: { on_or_before: to } },
  ]
  if (salesperson) filters.push({ property: '業務人員', select: { equals: salesperson } })

  const out: { date: string; salesperson: string }[] = []
  let cursor: string | undefined
  do {
    const response: any = await notionCallWithRetry('listVisitTallies', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        filter: { and: filters },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of response.results ?? []) {
      out.push({
        date: getDate(page, '日期'),
        salesperson: getSelect(page, '業務人員') || getText(page, '業務人員'),
      })
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}
