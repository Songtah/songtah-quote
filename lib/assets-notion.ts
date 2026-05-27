/**
 * assets-notion.ts
 * Handles reading/writing brand asset metadata in a dedicated Notion database.
 * Requires NOTION_ASSETS_DB env var to be set (see setup instructions).
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_ASSETS = process.env.NOTION_ASSETS_DB ?? ''

export const ASSET_CATEGORIES = [
  '產品照片',
  '品牌識別',
  '行銷素材',
  '型錄素材',
  '其他',
] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export interface BrandAsset {
  id:             string
  name:           string
  category:       string
  tags:           string[]
  compressedUrl:  string   // display URL (compressed)
  originalUrl:    string   // download URL (original quality)
  originalSize:   number   // bytes
  compressedSize: number   // bytes
  uploadedBy:     string
  createdAt:      string   // ISO timestamp
}

// ── Field bootstrap ──────────────────────────────────────────

let _ensured = false
async function ensureFields() {
  if (_ensured || !DB_ASSETS) return
  _ensured = true
  try {
    await notion.databases.update({
      database_id: DB_ASSETS,
      properties: {
        分類:       { select: { options: ASSET_CATEGORIES.map((c) => ({ name: c })) } },
        標籤:       { multi_select: {} },
        壓縮圖URL:  { url: {} },
        原圖URL:    { url: {} },
        原始大小:   { number: { format: 'number' } },
        壓縮後大小: { number: { format: 'number' } },
        上傳者:     { rich_text: {} },
      } as any,
    })
  } catch (e) {
    console.warn('[assets-notion] ensureFields:', e)
  }
}

// ── Helpers ──────────────────────────────────────────────────

function rt(content: string) {
  return [{ text: { content: content.slice(0, 2000) } }]
}

function readTitle(page: any): string {
  const arr: any[] = page.properties?.['素材名稱']?.title ?? []
  return arr.map((b: any) => b.plain_text).join('')
}

function readText(page: any, field: string): string {
  const arr: any[] = page.properties?.[field]?.rich_text ?? []
  return arr.map((b: any) => b.plain_text).join('')
}

function readUrl(page: any, field: string): string {
  return page.properties?.[field]?.url ?? ''
}

function readNumber(page: any, field: string): number {
  return page.properties?.[field]?.number ?? 0
}

function readSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function readMultiSelect(page: any, field: string): string[] {
  return (page.properties?.[field]?.multi_select ?? []).map((s: any) => s.name as string)
}

function pageToAsset(page: any): BrandAsset {
  return {
    id:             page.id,
    name:           readTitle(page),
    category:       readSelect(page, '分類'),
    tags:           readMultiSelect(page, '標籤'),
    compressedUrl:  readUrl(page, '壓縮圖URL'),
    originalUrl:    readUrl(page, '原圖URL'),
    originalSize:   readNumber(page, '原始大小'),
    compressedSize: readNumber(page, '壓縮後大小'),
    uploadedBy:     readText(page, '上傳者'),
    createdAt:      page.created_time ?? '',
  }
}

// ── Public API ───────────────────────────────────────────────

export function isAssetsDbConfigured(): boolean {
  return Boolean(DB_ASSETS)
}

export async function listAssets(category?: string): Promise<BrandAsset[]> {
  if (!DB_ASSETS) return []
  await ensureFields()

  const filter: any =
    category && category !== '全部'
      ? { property: '分類', select: { equals: category } }
      : undefined

  const resp = (await notion.databases.query({
    database_id: DB_ASSETS,
    ...(filter ? { filter } : {}),
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 100,
  })) as any

  return resp.results.map(pageToAsset)
}

export async function createAsset(data: {
  name:           string
  category:       string
  tags:           string[]
  compressedUrl:  string
  originalUrl:    string
  originalSize:   number
  compressedSize: number
  uploadedBy:     string
}): Promise<BrandAsset> {
  if (!DB_ASSETS) throw new Error('NOTION_ASSETS_DB not configured')
  await ensureFields()

  const page = (await notion.pages.create({
    parent: { database_id: DB_ASSETS },
    properties: {
      素材名稱:   { title: rt(data.name) },
      分類:       { select: { name: data.category || '其他' } },
      標籤:       { multi_select: data.tags.map((t) => ({ name: t })) },
      壓縮圖URL:  data.compressedUrl ? { url: data.compressedUrl } : { url: null },
      原圖URL:    data.originalUrl   ? { url: data.originalUrl }   : { url: null },
      原始大小:   { number: data.originalSize },
      壓縮後大小: { number: data.compressedSize },
      上傳者:     { rich_text: rt(data.uploadedBy) },
    },
  } as any)) as any

  return pageToAsset(page)
}

export async function deleteAsset(id: string): Promise<void> {
  await (notion.pages.update as any)({ page_id: id, archived: true })
}
