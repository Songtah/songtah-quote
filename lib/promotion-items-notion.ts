/**
 * promotion-items-notion.ts
 * CRUD for 促銷品項明細 — individual product entries within a promotion campaign.
 * Linked to 促銷活動 via 活動ID (rich_text).
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB = process.env.NOTION_PROMOTION_ITEMS_DB!

// ── Helpers ───────────────────────────────────────────────────

function richText(content: string) {
  if (!content) return []
  return [{ text: { content: content.slice(0, 2000) } }]
}

function getText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const arr: any[] = prop.rich_text ?? prop.title ?? []
  return arr.map((b: any) => b.plain_text ?? '').join('')
}

function getSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function getNumber(page: any, field: string): number | null {
  return page.properties?.[field]?.number ?? null
}

function formatId(id: string): string {
  const clean = id.replace(/-/g, '')
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

// ── Condition Types ───────────────────────────────────────────
//
// conditionType is stored as a Notion select; conditionParams is a JSON
// string in a rich_text field. The discriminated union keeps each type's
// params explicit while the catch-all branch allows future extension without
// breaking existing code.

export type ConditionType =
  | 'single_price'          // 單品特價
  | 'series_discount'       // 全系列折扣
  | 'qty_discount'          // 滿件折扣
  | 'buy_n_get_m'           // 買N送M（單品計數）
  | 'series_buy_n_get_m'    // 跨規格系列買N送M（系列合計計數，贈品自選）
  | 'fixed_set_price'       // N件固定價
  | 'buy_a_get_b'           // 買A送B（主商品觸發贈品）
  | 'add_on'                // 加價購（需綁定主商品）
  | 'bundle'                // 商品組合優惠
  | (string & {})           // extensible — future types won't break the union

export const CONDITION_TYPE_LABEL: Record<string, string> = {
  single_price:         '單品特價',
  series_discount:      '全系列折扣',
  qty_discount:         '滿件折扣',
  buy_n_get_m:          '買N送M',
  series_buy_n_get_m:   '跨規格系列買N送M',
  fixed_set_price:      'N件固定價',
  buy_a_get_b:          '買A送B',
  add_on:               '加價購',
  bundle:               '商品組合優惠',
}

// Tier used by qty_discount and fixed_set_price
export interface QtyDiscountTier  { minQty: number; rate?: number; price?: number }
export interface FixedSetPriceTier { qty: number; totalPrice: number }

// Discriminated union — add new branches here as new types are introduced
export type ConditionParams =
  | { type: 'single_price';        price: number }
  | { type: 'series_discount';     rate: number }                         // 0.7 = 七折
  | { type: 'qty_discount';        tiers: QtyDiscountTier[] }
  | { type: 'buy_n_get_m';         n: number; m: number }
  | { type: 'series_buy_n_get_m';  n: number; m: number }                // 跨規格系列合計，贈品自選
  | { type: 'fixed_set_price';     tiers: FixedSetPriceTier[] }
  | { type: 'buy_a_get_b';         giftSkuCode: string; giftSkuName: string; giftQty: number }
  | { type: 'add_on';              addOnPrice: number; mainSkuCode?: string; mainSkuName?: string }
  | { type: 'bundle';              partnerSkuCode: string; partnerSkuName?: string; bundlePrice?: number; rate?: number }
  | { type: string; [key: string]: unknown }  // catch-all for forward-compat

// ── Types ─────────────────────────────────────────────────────

export type ItemStatus = '待定價' | '已確認' | '不採用'

export interface PromotionItem {
  id:              string
  promotionId:     string
  promotionName:   string
  skuCode:         string   // 空字串時表示這是系列層級品項
  skuName:         string
  brand:           string
  seriesId:        string   // ProductFamily.id；非空時為系列層級
  seriesName:      string
  condition:       string           // human-readable summary (free text)
  conditionType:   ConditionType | null
  conditionParams: ConditionParams | null
  usedQuota:       number           // for service_plan: tracks consumed quota
  price:           number | null    // 促銷價格 (base / reference price)
  status:          ItemStatus
  adminNote:       string
  createdTime:     string
}

export const ITEM_STATUS_COLOR: Record<ItemStatus, string> = {
  '待定價': 'bg-yellow-100 text-yellow-700',
  '已確認': 'bg-green-100  text-green-700',
  '不採用': 'bg-red-100    text-red-600',
}

// ── Ensure DB fields exist ────────────────────────────────────

let _ensured: Promise<void> | null = null
export function ensurePromotionItemFields(): Promise<void> {
  if (_ensured) return _ensured
  _ensured = (async () => {
    try {
      const db: any = await notion.databases.retrieve({ database_id: DB })
      const props = db.properties ?? {}
      const updates: any = {}

      if (!props['conditionType'])
        updates['conditionType'] = { select: {} }

      if (!props['conditionParams'])
        updates['conditionParams'] = { rich_text: {} }

      if (!props['usedQuota'])
        updates['usedQuota'] = { number: { format: 'number' } }

      if (!props['seriesId'])
        updates['seriesId'] = { rich_text: {} }

      if (!props['seriesName'])
        updates['seriesName'] = { rich_text: {} }

      if (Object.keys(updates).length > 0)
        await notion.databases.update({ database_id: DB, properties: updates })
    } catch {
      // Non-fatal — fields may already exist or DB access may be restricted
    }
  })()
  return _ensured
}

// ── Parse ─────────────────────────────────────────────────────

function parseConditionParams(raw: string): ConditionParams | null {
  if (!raw) return null
  try { return JSON.parse(raw) as ConditionParams }
  catch { return null }
}

function parsePage(page: any): PromotionItem {
  const conditionType = getSelect(page, 'conditionType') || null
  const conditionParamsRaw = getText(page, 'conditionParams')
  const conditionParams = parseConditionParams(conditionParamsRaw)

  return {
    id:              page.id.replace(/-/g, ''),
    promotionId:     getText(page, '活動ID'),
    promotionName:   getText(page, '活動名稱'),
    skuCode:         getText(page, '貨號'),
    skuName:         getText(page, '品名'),
    brand:           getText(page, '品牌'),
    seriesId:        getText(page, 'seriesId'),
    seriesName:      getText(page, 'seriesName'),
    condition:       getText(page, '促銷條件'),
    conditionType:   conditionType as ConditionType | null,
    conditionParams,
    usedQuota:       getNumber(page, 'usedQuota') ?? 0,
    price:           page.properties?.['促銷價格']?.number ?? null,
    status:          (getSelect(page, '品項狀態') || '待定價') as ItemStatus,
    adminNote:       getText(page, '行政備注'),
    createdTime:     page.created_time ?? '',
  }
}

// ── Read ──────────────────────────────────────────────────────

export async function listItemsByPromotion(promotionId: string): Promise<PromotionItem[]> {
  await ensurePromotionItemFields()
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: DB,
      filter: { property: '活動ID', rich_text: { equals: promotionId } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results.map(parsePage)
}

// ── Write ─────────────────────────────────────────────────────

export async function createPromotionItem(data: {
  promotionId:      string
  promotionName:    string
  skuCode:          string
  skuName:          string
  brand:            string
  seriesId?:        string
  seriesName?:      string
  condition?:       string
  conditionType?:   ConditionType
  conditionParams?: ConditionParams
  price?:           number | null
  adminNote?:       string
}): Promise<PromotionItem> {
  await ensurePromotionItemFields()
  const page: any = await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '品名':          { title:     richText(data.skuName) },
      '活動ID':        { rich_text: richText(data.promotionId) },
      '活動名稱':      { rich_text: richText(data.promotionName) },
      '貨號':          { rich_text: richText(data.skuCode) },
      '品牌':          { rich_text: richText(data.brand) },
      'seriesId':      { rich_text: richText(data.seriesId   ?? '') },
      'seriesName':    { rich_text: richText(data.seriesName ?? '') },
      '促銷條件':      { rich_text: richText(data.condition ?? '') },
      'conditionType': data.conditionType ? { select: { name: data.conditionType } } : { select: null },
      'conditionParams': data.conditionParams
        ? { rich_text: richText(JSON.stringify(data.conditionParams)) }
        : { rich_text: [] },
      '促銷價格':      data.price != null ? { number: data.price } : { number: null },
      '品項狀態':      { select: { name: '待定價' } },
      '行政備注':      { rich_text: richText(data.adminNote ?? '') },
      'usedQuota':     { number: 0 },
    },
  })
  return parsePage(page)
}

export async function updatePromotionItem(id: string, data: {
  condition?:      string
  conditionType?:  ConditionType | null
  conditionParams?: ConditionParams | null
  usedQuota?:      number
  price?:          number | null
  status?:         ItemStatus
  adminNote?:      string
}): Promise<void> {
  const props: any = {}
  if (data.condition      !== undefined) props['促銷條件']      = { rich_text: richText(data.condition) }
  if (data.conditionType  !== undefined) props['conditionType'] = data.conditionType ? { select: { name: data.conditionType } } : { select: null }
  if (data.conditionParams !== undefined) props['conditionParams'] = data.conditionParams
    ? { rich_text: richText(JSON.stringify(data.conditionParams)) }
    : { rich_text: [] }
  if (data.usedQuota      !== undefined) props['usedQuota']     = { number: data.usedQuota }
  if (data.price          !== undefined) props['促銷價格']      = data.price != null ? { number: data.price } : { number: null }
  if (data.status         !== undefined) props['品項狀態']      = { select: { name: data.status } }
  if (data.adminNote      !== undefined) props['行政備注']      = { rich_text: richText(data.adminNote) }

  if (Object.keys(props).length > 0)
    await notion.pages.update({ page_id: formatId(id), properties: props })
}

export async function updateUsedQuota(id: string, usedQuota: number): Promise<void> {
  await notion.pages.update({
    page_id: formatId(id),
    properties: { usedQuota: { number: usedQuota } },
  })
}

export async function deletePromotionItem(id: string): Promise<void> {
  await notion.pages.update({ page_id: formatId(id), archived: true })
}
