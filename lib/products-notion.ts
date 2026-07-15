/**
 * products-notion.ts
 * Handles reading/writing "rich" product data (售價、圖片、介紹) in the
 * Notion Products DB, keyed by SKU code (貨號).
 *
 * The catalog JSON (products_catalog.json) remains the authoritative source
 * for 貨號, 品名, 品牌, 分類. Notion stores the enrichment layer.
 */

import { Client } from '@notionhq/client'
import { getRedisValue, setRedisValue } from '@/lib/notion/shared'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_PRODUCTS = process.env.NOTION_PRODUCTS_DB!

// ── Helpers ──────────────────────────────────────────────────

function richText(content: string) {
  if (!content) return []
  const chunks = content.match(/[\s\S]{1,2000}/g) ?? []
  return chunks.map((chunk) => ({ text: { content: chunk } }))
}

function readRichText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const arr: any[] = prop.rich_text ?? []
  return arr.map((b: any) => b.plain_text ?? '').join('')
}

function readNumber(page: any, field: string): number | null {
  return page.properties?.[field]?.number ?? null
}

function readUrl(page: any, field: string): string {
  return page.properties?.[field]?.url ?? ''
}

function readCheckbox(page: any, field: string): boolean {
  return page.properties?.[field]?.checkbox ?? false
}

const DISABLED_SKUS_CACHE_KEY = 'products:central-disabled-skus:v1'
const DISABLED_SKUS_CACHE_TTL = 60_000
let lastDisabledSkuCodes: string[] | null = null
let lastDisabledSkuCodesAt = 0

// ── Types ────────────────────────────────────────────────────

export interface ProductRichData {
  notionId:    string
  price:       number | null   // 售價
  imageUrl:    string          // 圖片URL
  description: string          // 商品介紹
  specsJson:   string          // 技術規格 — raw JSON stored in Notion; parse on client
  galleryJson: string          // 形象素材 — JSON: string[] of image URLs
  docsJson:    string          // 文件資料 — JSON: { name, url, size }[]
  familyId:    string          // 系列群組 — manually assigned family ID
  disabled:    boolean         // 中央停用 — 可逆的人工停用，不等同主檔停售
}

export interface CatalogSnapshot {
  name:        string
  brand:       string
  category:    string
  productType: string
}

// ── Read ─────────────────────────────────────────────────────

/**
 * Look up rich data for a SKU code. Returns null when no Notion record
 * exists yet (first time editing a product).
 */
export async function getProductRichData(skuCode: string): Promise<ProductRichData | null> {
  const resp = await notion.databases.query({
    database_id: DB_PRODUCTS,
    filter: { property: '貨號', rich_text: { equals: skuCode } },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 1,
  }) as any

  if (!resp.results?.length) return null

  const page = resp.results[0]
  return {
    notionId:    page.id,
    price:       readNumber(page, '售價'),
    imageUrl:    readUrl(page, '圖片URL'),
    description: readRichText(page, '商品介紹'),
    specsJson:   readRichText(page, '技術規格'),
    galleryJson: readRichText(page, '形象素材'),
    docsJson:    readRichText(page, '文件資料'),
    familyId:    readRichText(page, '系列群組'),
    disabled:    readCheckbox(page, '中央停用'),
  }
}

// ── Write ────────────────────────────────────────────────────

/**
 * Create or update a product's rich data in Notion.
 * Returns the Notion page ID.
 */
export async function upsertProductRichData(
  skuCode: string,
  catalog: CatalogSnapshot,
  data: {
    price?:       number | null
    imageUrl?:    string
    description?: string
    specsJson?:   string
    galleryJson?: string
    docsJson?:    string
    familyId?:    string
    disabled?:    boolean
  }
): Promise<string> {
  // Build the properties patch
  const props: Record<string, any> = {}
  if (data.price !== undefined)
    props['售價'] = data.price != null ? { number: data.price } : { number: null }
  if (data.imageUrl !== undefined)
    props['圖片URL'] = data.imageUrl ? { url: data.imageUrl } : { url: null }
  if (data.description !== undefined)
    props['商品介紹'] = { rich_text: richText(data.description) }
  if (data.specsJson !== undefined)
    props['技術規格'] = { rich_text: richText(data.specsJson) }
  if (data.galleryJson !== undefined)
    props['形象素材'] = { rich_text: richText(data.galleryJson) }
  if (data.docsJson !== undefined)
    props['文件資料'] = { rich_text: richText(data.docsJson) }
  if (data.familyId !== undefined)
    props['系列群組'] = { rich_text: richText(data.familyId) }
  if (data.disabled !== undefined)
    props['中央停用'] = { checkbox: data.disabled }

  // Check if a page already exists for this SKU
  const existing = await getProductRichData(skuCode)

  if (existing) {
    await notion.pages.update({
      page_id: existing.notionId,
      properties: props,
    } as any)
    return existing.notionId
  }

  // Create new page
  // Field names must match the actual Notion DB schema:
  //   Title  → 'Name'  (Notion default title property)
  //   分類   → '系列'  (select)
  //   商品類型 → '類型' (select)
  const page = await notion.pages.create({
    parent: { database_id: DB_PRODUCTS },
    properties: {
      'Name':   { title: richText(catalog.name) },
      '貨號':   { rich_text: richText(skuCode) },
      '生產商': { select: { name: catalog.brand || '其他' } },
      '系列':   { select: { name: catalog.category || '其他' } },
      '類型':   { select: { name: catalog.productType || '其他' } },
      ...props,
    },
  } as any) as any

  return page.id
}

/**
 * Returns SKU codes manually disabled by central management.
 * The static catalog's discontinued/status fields remain a separate authority.
 */
export async function listDisabledSkuCodes(refresh = false): Promise<string[]> {
  if (!refresh && lastDisabledSkuCodes && Date.now() - lastDisabledSkuCodesAt < DISABLED_SKUS_CACHE_TTL) {
    return lastDisabledSkuCodes
  }
  if (!refresh) {
    const cached = await getRedisValue<string[]>(DISABLED_SKUS_CACHE_KEY)
    if (cached) {
      lastDisabledSkuCodes = cached
      lastDisabledSkuCodesAt = Date.now()
      return cached
    }
  }

  try {
    const results: any[] = []
    let cursor: string | undefined
    do {
      const resp: any = await notion.databases.query({
        database_id: DB_PRODUCTS,
        filter: { property: '中央停用', checkbox: { equals: true } },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
      results.push(...resp.results)
      cursor = resp.has_more ? resp.next_cursor : undefined
    } while (cursor)

    const codes = Array.from(new Set(results.map((page) => readRichText(page, '貨號')).filter(Boolean)))
    lastDisabledSkuCodes = codes
    lastDisabledSkuCodesAt = Date.now()
    await setRedisValue(DISABLED_SKUS_CACHE_KEY, codes, DISABLED_SKUS_CACHE_TTL)
    return codes
  } catch (error) {
    console.error('[products-notion] disabled SKU list unavailable:', error)
    if (lastDisabledSkuCodes) return lastDisabledSkuCodes
    throw new Error('產品停用狀態暫時無法讀取，已停止產品選取以避免誤用停用品')
  }
}

/** Update both process-local and Redis caches from a pre-write snapshot. */
export async function updateDisabledSkuCache(
  skuCode: string,
  disabled: boolean,
  snapshot: string[],
): Promise<void> {
  const next = new Set(snapshot)
  if (disabled) next.add(skuCode)
  else next.delete(skuCode)
  const codes = Array.from(next)
  lastDisabledSkuCodes = codes
  lastDisabledSkuCodesAt = Date.now()
  await setRedisValue(DISABLED_SKUS_CACHE_KEY, codes, DISABLED_SKUS_CACHE_TTL)
}

// ── Query by family ID ────────────────────────────────────────

/**
 * Returns all SKU codes (貨號) in Notion Products DB that have 系列群組 === familyId.
 */
export async function listSkusByFamilyId(familyId: string): Promise<string[]> {
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: DB_PRODUCTS,
      filter: { property: '系列群組', rich_text: { equals: familyId } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results.map((p: any) => readRichText(p, '貨號')).filter(Boolean)
}

/**
 * Returns all SKU codes that have any manual family assignment in Notion.
 * Used by OrderForm to exclude these from flat search results (dedup).
 */
export async function listAllFamilyAssignments(): Promise<string[]> {
  const assignments = await listFamilyAssignments()
  return assignments.map((assignment) => assignment.skuCode)
}

export interface ProductFamilyAssignment {
  skuCode: string
  familyId: string
}

/** Returns every explicit SKU → family assignment stored in Notion. */
export async function listFamilyAssignments(): Promise<ProductFamilyAssignment[]> {
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: DB_PRODUCTS,
      filter: { property: '系列群組', rich_text: { is_not_empty: true } },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  const assignments = results.map((page: any) => ({
      skuCode: readRichText(page, '貨號'),
      familyId: readRichText(page, '系列群組'),
    }))
    .filter((assignment) => Boolean(assignment.skuCode && assignment.familyId))
  const latestBySku = new Map<string, ProductFamilyAssignment>()
  for (const assignment of assignments) {
    if (!latestBySku.has(assignment.skuCode)) latestBySku.set(assignment.skuCode, assignment)
  }
  return Array.from(latestBySku.values())
}
