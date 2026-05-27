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

// ── Field ensure (run once per process) ─────────────────────

let _fieldsEnsured = false
async function ensureFields() {
  if (_fieldsEnsured) return
  _fieldsEnsured = true
  try {
    await notion.databases.update({
      database_id: DB_PRODUCTS,
      properties: {
        '貨號':     { rich_text: {} },
        '售價':     { number: { format: 'number' } },
        '圖片URL':  { url: {} },
        '商品介紹': { rich_text: {} },
      } as any,
    })
  } catch (e) {
    // Best-effort: fields may already exist or permissions may differ
    console.warn('[products-notion] ensureFields warning:', e)
  }
}

// ── Helpers ──────────────────────────────────────────────────

function richText(content: string) {
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
  notionId: string
  price:       number | null   // 售價
  imageUrl:    string          // 圖片URL
  description: string          // 商品介紹
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
  const page = await notion.pages.create({
    parent: { database_id: DB_PRODUCTS },
    properties: {
      '品名':     { title: richText(catalog.name) },
      '貨號':     { rich_text: richText(skuCode) },
      '生產商':   { select: { name: catalog.brand || '其他' } },
      '分類':     { select: { name: catalog.category || '其他' } },
      '商品類型': { select: { name: catalog.productType || '其他' } },
      ...props,
    },
  } as any) as any

  return page.id
}
