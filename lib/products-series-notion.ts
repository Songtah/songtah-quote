/**
 * 產品系列資料庫 (Notion)
 * DB ID: NOTION_SERIES_DB
 *
 * 欄位：
 *   系列名稱  (title)   — 顯示名稱，e.g. "3D Master 氧化鋯塊"
 *   系列代碼  (text)    — seriesCode，e.g. "BS-STML"（與 product_families.json 對應）
 *   品牌      (select)  — BSM 貝施美 / Zirkonzahn / YAMAHACHI / 其他
 *   介紹說明  (text)    — 系列整體文字介紹
 *   主圖URL   (url)     — 系列封面圖
 *   技術參數  (text)    — 彎曲強度、燒結溫度等
 *   適用範圍  (text)    — 牙冠、橋體等適用說明
 *   備註      (text)
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

function getSeriesDb(): string {
  const id = process.env.NOTION_SERIES_DB
  if (!id) throw new Error('NOTION_SERIES_DB env var not set')
  return id.replace('collection://', '')
}

function richText(content: string) {
  return [{ type: 'text' as const, text: { content } }]
}

function getProp(page: any, field: string) {
  return page.properties?.[field]
}

function getTitle(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'title') return prop.title?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'rich_text') return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  return ''
}

function getText(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'rich_text') return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'url') return prop.url ?? ''
  return ''
}

function getSelect(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'select') return prop.select?.name ?? ''
  return ''
}

function getUrl(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'url') return prop.url ?? ''
  return ''
}

// ── Types ──────────────────────────────────────────────────────

export interface SeriesRecord {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  description: string
  imageUrl: string
  technicalSpecs: string
  applicableScope: string
  notes: string
}

// ── Mappers ────────────────────────────────────────────────────

function mapPage(page: any): SeriesRecord {
  return {
    id: page.id,
    seriesName: getTitle(page, '系列名稱'),
    seriesCode: getText(page, '系列代碼'),
    brand: getSelect(page, '品牌'),
    description: getText(page, '介紹說明'),
    imageUrl: getUrl(page, '主圖URL'),
    technicalSpecs: getText(page, '技術參數'),
    applicableScope: getText(page, '適用範圍'),
    notes: getText(page, '備註'),
  }
}

// ── CRUD ───────────────────────────────────────────────────────

/** Get all series records (no pagination needed — typically < 200 series). */
export async function listSeriesRecords(): Promise<SeriesRecord[]> {
  const dbId = getSeriesDb()
  const response: any = await notion.databases.query({
    database_id: dbId,
    page_size: 100,
    sorts: [{ property: '系列代碼', direction: 'ascending' }],
  })
  return (response.results ?? []).map(mapPage)
}

/** Get a single series record by seriesCode. Returns null if not found. */
export async function getSeriesByCode(seriesCode: string): Promise<SeriesRecord | null> {
  const dbId = getSeriesDb()
  const response: any = await notion.databases.query({
    database_id: dbId,
    page_size: 1,
    filter: { property: '系列代碼', rich_text: { equals: seriesCode } },
  })
  const first = response.results?.[0]
  return first ? mapPage(first) : null
}

/** Create a new series record. */
export async function createSeriesRecord(data: {
  seriesCode: string
  seriesName: string
  brand?: string
  description?: string
  imageUrl?: string
  technicalSpecs?: string
  applicableScope?: string
  notes?: string
}): Promise<SeriesRecord> {
  const dbId = getSeriesDb()
  const response: any = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      系列名稱: { title: richText(data.seriesName) },
      系列代碼: { rich_text: richText(data.seriesCode) },
      ...(data.brand ? { 品牌: { select: { name: data.brand } } } : {}),
      ...(data.description ? { 介紹說明: { rich_text: richText(data.description) } } : {}),
      ...(data.imageUrl ? { 主圖URL: { url: data.imageUrl } } : {}),
      ...(data.technicalSpecs ? { 技術參數: { rich_text: richText(data.technicalSpecs) } } : {}),
      ...(data.applicableScope ? { 適用範圍: { rich_text: richText(data.applicableScope) } } : {}),
      ...(data.notes ? { 備註: { rich_text: richText(data.notes) } } : {}),
    } as any,
  })
  return mapPage(response)
}

/** Update a series record by Notion page ID. */
export async function updateSeriesRecord(
  pageId: string,
  data: Partial<{
    seriesCode: string
    seriesName: string
    brand: string
    description: string
    imageUrl: string
    technicalSpecs: string
    applicableScope: string
    notes: string
  }>
): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.seriesName !== undefined) properties['系列名稱'] = { title: richText(data.seriesName) }
  if (data.seriesCode !== undefined) properties['系列代碼'] = { rich_text: richText(data.seriesCode) }
  if (data.brand !== undefined) properties['品牌'] = data.brand ? { select: { name: data.brand } } : { select: null }
  if (data.description !== undefined) properties['介紹說明'] = { rich_text: richText(data.description) }
  if (data.imageUrl !== undefined) properties['主圖URL'] = data.imageUrl ? { url: data.imageUrl } : { url: null }
  if (data.technicalSpecs !== undefined) properties['技術參數'] = { rich_text: richText(data.technicalSpecs) }
  if (data.applicableScope !== undefined) properties['適用範圍'] = { rich_text: richText(data.applicableScope) }
  if (data.notes !== undefined) properties['備註'] = { rich_text: richText(data.notes) }

  await notion.pages.update({ page_id: pageId, properties } as any)
}
