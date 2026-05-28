/**
 * products-notion.ts
 * Handles reading/writing "rich" product data (售價、圖片、介紹) in the
 * Notion Products DB, keyed by SKU code (貨號).
 *
 * The catalog JSON (products_catalog.json) remains the authoritative source
 * for 貨號, 品名, 品牌, 分類. Notion stores the enrichment layer.
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_PRODUCTS = process.env.NOTION_PRODUCTS_DB!

// ── Field ensure ────────────────────────────────────────────
// _specsFieldReady tracks whether '技術規格' was successfully added
// to the DB schema — we only write that field when we're sure it exists.

let _ensurePromise:    Promise<void> | null = null
let _specsFieldReady:  boolean              = false

function ensureFields(): Promise<void> {
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      try {
        await notion.databases.update({
          database_id: DB_PRODUCTS,
          properties: {
            '貨號':     { rich_text: {} },
            '售價':     { number: { format: 'number' } },
            '圖片URL':  { url: {} },
            '商品介紹': { rich_text: {} },
            '技術規格': { rich_text: {} },  // JSON: { columns, rows }
            '形象素材': { rich_text: {} },  // JSON: string[] of image URLs
            '文件資料': { rich_text: {} },  // JSON: { name, url, size }[]
            '系列群組': { rich_text: {} },  // manually assigned family ID
          } as any,
        })
        _specsFieldReady = true
      } catch (e: any) {
        console.warn('[products-notion] ensureFields warning:', e?.message ?? e)
        // Allow retry after 60 s so transient failures don't block forever
        setTimeout(() => { _ensurePromise = null }, 60_000)
      }
    })()
  }
  return _ensurePromise
}

// ── Helpers ──────────────────────────────────────────────────

function richText(content: string) {
  // Empty string → empty array (Notion's canonical empty rich_text)
  if (!content) return []
  return [{ text: { content: content.slice(0, 2000) } }]
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
  await ensureFields()
  const resp = await notion.databases.query({
    database_id: DB_PRODUCTS,
    filter: { property: '貨號', rich_text: { equals: skuCode } },
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
  }
): Promise<string> {
  await ensureFields()

  // Build the properties patch
  const props: Record<string, any> = {}
  if (data.price !== undefined)
    props['售價'] = data.price != null ? { number: data.price } : { number: null }
  if (data.imageUrl !== undefined)
    props['圖片URL'] = data.imageUrl ? { url: data.imageUrl } : { url: null }
  if (data.description !== undefined)
    props['商品介紹'] = { rich_text: richText(data.description) }
  // Only write 技術規格 / 形象素材 if we confirmed the fields exist in the DB schema
  if (data.specsJson !== undefined && _specsFieldReady)
    props['技術規格'] = { rich_text: richText(data.specsJson) }
  if (data.galleryJson !== undefined && _specsFieldReady)
    props['形象素材'] = { rich_text: richText(data.galleryJson) }
  if (data.docsJson !== undefined && _specsFieldReady)
    props['文件資料'] = { rich_text: richText(data.docsJson) }
  if (data.familyId !== undefined && _specsFieldReady)
    props['系列群組'] = { rich_text: richText(data.familyId) }

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

// ── Query by family ID ────────────────────────────────────────

/**
 * Returns all SKU codes (貨號) in Notion Products DB that have 系列群組 === familyId.
 */
export async function listSkusByFamilyId(familyId: string): Promise<string[]> {
  await ensureFields()
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
  await ensureFields()
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: DB_PRODUCTS,
      filter: { property: '系列群組', rich_text: { is_not_empty: true } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results.map((p: any) => readRichText(p, '貨號')).filter(Boolean)
}
