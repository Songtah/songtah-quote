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

function formatId(id: string): string {
  const clean = id.replace(/-/g, '')
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

// ── Types ─────────────────────────────────────────────────────

export type ItemStatus = '待定價' | '已確認' | '不採用'

export interface PromotionItem {
  id:           string
  promotionId:  string
  promotionName: string
  skuCode:      string
  skuName:      string
  brand:        string
  condition:    string        // 促銷條件 (free text)
  price:        number | null // 促銷價格
  status:       ItemStatus
  adminNote:    string
  createdTime:  string
}

export const ITEM_STATUS_COLOR: Record<ItemStatus, string> = {
  '待定價': 'bg-yellow-100 text-yellow-700',
  '已確認': 'bg-green-100  text-green-700',
  '不採用': 'bg-red-100    text-red-600',
}

// ── Parse ─────────────────────────────────────────────────────

function parsePage(page: any): PromotionItem {
  return {
    id:            page.id.replace(/-/g, ''),
    promotionId:   getText(page, '活動ID'),
    promotionName: getText(page, '活動名稱'),
    skuCode:       getText(page, '貨號'),
    skuName:       getText(page, '品名'),
    brand:         getText(page, '品牌'),
    condition:     getText(page, '促銷條件'),
    price:         page.properties?.['促銷價格']?.number ?? null,
    status:        (getSelect(page, '品項狀態') || '待定價') as ItemStatus,
    adminNote:     getText(page, '行政備注'),
    createdTime:   page.created_time ?? '',
  }
}

// ── Read ──────────────────────────────────────────────────────

export async function listItemsByPromotion(promotionId: string): Promise<PromotionItem[]> {
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
  promotionId:   string
  promotionName: string
  skuCode:       string
  skuName:       string
  brand:         string
  condition?:    string
  price?:        number | null
  adminNote?:    string
}): Promise<PromotionItem> {
  const page: any = await notion.pages.create({
    parent: { database_id: DB },
    properties: {
      '品名':     { title:     richText(data.skuName) },
      '活動ID':   { rich_text: richText(data.promotionId) },
      '活動名稱': { rich_text: richText(data.promotionName) },
      '貨號':     { rich_text: richText(data.skuCode) },
      '品牌':     { rich_text: richText(data.brand) },
      '促銷條件': { rich_text: richText(data.condition ?? '') },
      '促銷價格': data.price != null ? { number: data.price } : { number: null },
      '品項狀態': { select: { name: '待定價' } },
      '行政備注': { rich_text: richText(data.adminNote ?? '') },
    },
  })
  return parsePage(page)
}

export async function updatePromotionItem(id: string, data: {
  condition?:  string
  price?:      number | null
  status?:     ItemStatus
  adminNote?:  string
}): Promise<void> {
  const props: any = {}
  if (data.condition  !== undefined) props['促銷條件'] = { rich_text: richText(data.condition) }
  if (data.price      !== undefined) props['促銷價格'] = data.price != null ? { number: data.price } : { number: null }
  if (data.status     !== undefined) props['品項狀態'] = { select: { name: data.status } }
  if (data.adminNote  !== undefined) props['行政備注'] = { rich_text: richText(data.adminNote) }

  if (Object.keys(props).length > 0)
    await notion.pages.update({ page_id: formatId(id), properties: props })
}

export async function deletePromotionItem(id: string): Promise<void> {
  await notion.pages.update({ page_id: formatId(id), archived: true })
}
