/**
 * products-notion.ts
 * Handles reading/writing "rich" product data (售價、圖片、介紹) in the
 * Notion Products DB, keyed by SKU code (貨號).
 *
 * The catalog JSON (products_catalog.json) remains the authoritative source
 * for 貨號, 品名, 品牌, 分類. Notion stores the enrichment layer.
 */

import { Client } from '@notionhq/client'
import { get, head, put } from '@vercel/blob'
import { deleteRedisValue, getRedis, getRedisValue, setRedisValue } from '@/lib/notion/shared'

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
const PRICE_OVERRIDES_CACHE_KEY = 'products:price-overrides:v1'
const PRICE_OVERRIDES_CACHE_TTL = 60_000
let lastPriceOverrides: Record<string, number> | null = null
let lastPriceOverridesAt = 0
const IMAGE_INDEX_VERSION_KEY = 'products:image-index:active-version'
const IMAGE_INDEX_BUILDING_VERSION_KEY = 'products:image-index:building-version'
const IMAGE_INDEX_DIRTY_KEY = 'products:image-index:dirty'
const IMAGE_INDEX_KEY_PREFIX = 'products:image-index'
const PRODUCT_IMAGE_BLOB_INDEX_URL = process.env.PRODUCT_IMAGE_BLOB_INDEX_URL
  || 'https://irui8ert6hs4ddec.public.blob.vercel-storage.com/products/catalog/image-index.json'
let blobImageIndexUpdateQueue: Promise<void> = Promise.resolve()

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
  if (data.imageUrl !== undefined && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required before updating a product image')
  }
  if (data.imageUrl !== undefined) await markProductImageIndexDirty(skuCode)
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
    if (data.imageUrl !== undefined) await updateProductImageIndex(skuCode, catalog.brand, data.imageUrl)
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

  if (data.imageUrl !== undefined) await updateProductImageIndex(skuCode, catalog.brand, data.imageUrl)
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

/** Central-management price overrides keyed by SKU. Empty/cleared values are omitted. */
export async function listProductPriceOverrides(refresh = false): Promise<Record<string, number>> {
  if (!refresh && lastPriceOverrides && Date.now() - lastPriceOverridesAt < PRICE_OVERRIDES_CACHE_TTL) {
    return lastPriceOverrides
  }
  if (!refresh) {
    const cached = await getRedisValue<Record<string, number>>(PRICE_OVERRIDES_CACHE_KEY)
    if (cached) {
      lastPriceOverrides = cached
      lastPriceOverridesAt = Date.now()
      return cached
    }
  }

  try {
    const results: any[] = []
    let cursor: string | undefined
    do {
      const resp: any = await notion.databases.query({
        database_id: DB_PRODUCTS,
        filter: { property: '售價', number: { is_not_empty: true } },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
      results.push(...resp.results)
      cursor = resp.has_more ? resp.next_cursor : undefined
    } while (cursor)

    const overrides: Record<string, number> = {}
    for (const page of results) {
      const skuCode = readRichText(page, '貨號')
      const price = readNumber(page, '售價')
      if (skuCode && price != null && price > 0 && overrides[skuCode] === undefined) overrides[skuCode] = price
    }
    lastPriceOverrides = overrides
    lastPriceOverridesAt = Date.now()
    await setRedisValue(PRICE_OVERRIDES_CACHE_KEY, overrides, PRICE_OVERRIDES_CACHE_TTL)
    return overrides
  } catch (error) {
    console.error('[products-notion] price overrides unavailable:', error)
    if (!refresh && lastPriceOverrides) return lastPriceOverrides
    throw new Error('產品售價覆寫暫時無法讀取，已停止產品定價以避免使用錯誤價格')
  }
}

/** Clear both cache layers so the next price read must re-query Notion. */
export function invalidateProductPriceOverrideCache(): void {
  lastPriceOverrides = null
  lastPriceOverridesAt = 0
  deleteRedisValue(PRICE_OVERRIDES_CACHE_KEY)
}

function imageIndexShardKey(version: string | number, manufacturer: string): string {
  return `${IMAGE_INDEX_KEY_PREFIX}:${version}:${encodeURIComponent(manufacturer || '__empty__')}`
}

/** Read only the versioned Redis projection. User requests never rebuild from Notion. */
export async function listProductImageIndex(manufacturers: string[]): Promise<Record<string, string>> {
  const redis = getRedis()
  if (!redis) return readBlobProductImageIndex()
  try {
    const version = await redis.get<string | number>(IMAGE_INDEX_VERSION_KEY)
    if (version === null || version === undefined) return readBlobProductImageIndex()
    const uniqueManufacturers = Array.from(new Set(manufacturers.map((name) => name || '__empty__')))
    const pipeline = redis.pipeline()
    for (const manufacturer of uniqueManufacturers) {
      pipeline.hgetall<Record<string, string>>(imageIndexShardKey(version, manufacturer))
    }
    const shards = await pipeline.exec() as Array<Record<string, string> | null>
    return Object.assign({}, ...shards.filter(Boolean))
  } catch (error) {
    console.error('[products-notion] Redis image index unavailable:', error)
    return readBlobProductImageIndex()
  }
}

/** Best-effort atomic projection update after the authoritative Notion write succeeds. */
async function updateProductImageIndex(skuCode: string, manufacturer: string, imageUrl: string): Promise<void> {
  const redis = getRedis()
  await updateBlobProductImageIndex(skuCode, imageUrl)
  if (!redis) return
  try {
    const [activeVersion, buildingVersion] = await redis.mget<(string | number | null)[]>(
      IMAGE_INDEX_VERSION_KEY,
      IMAGE_INDEX_BUILDING_VERSION_KEY,
    )
    const versions = Array.from(new Set([activeVersion, buildingVersion].filter((version) => version !== null && version !== undefined)))
    if (versions.length === 0) return
    const pipeline = redis.pipeline()
    for (const version of versions) {
      const key = imageIndexShardKey(version as string | number, manufacturer)
      if (imageUrl) pipeline.hset(key, { [skuCode]: imageUrl })
      else pipeline.hdel(key, skuCode)
    }
    pipeline.hdel(IMAGE_INDEX_DIRTY_KEY, skuCode)
    await pipeline.exec()
  } catch (error) {
    console.warn('[products-notion] image index projection update failed:', error)
  }
}

async function readBlobProductImageIndex(): Promise<Record<string, string>> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN
    if (token) {
      const result = await get(PRODUCT_IMAGE_BLOB_INDEX_URL, { access: 'public', token })
      if (!result) return {}
      const data = await new Response(result.stream).json()
      return data?.images && typeof data.images === 'object' ? data.images : {}
    }
    const cacheBucket = Math.floor(Date.now() / 60_000)
    const response = await fetch(`${PRODUCT_IMAGE_BLOB_INDEX_URL}?v=${cacheBucket}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return data?.images && typeof data.images === 'object' ? data.images : {}
  } catch (error) {
    console.warn('[products-notion] Blob image index unavailable:', error)
    return {}
  }
}

async function updateBlobProductImageIndex(skuCode: string, imageUrl: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required to update the product image index')
  const operation = blobImageIndexUpdateQueue.then(async () => {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let writeCommitted = false
      try {
        const current = await head(PRODUCT_IMAGE_BLOB_INDEX_URL, { token })
        let currentBlob = null
        for (let readAttempt = 1; readAttempt <= 12 && !currentBlob; readAttempt += 1) {
          const candidate = await get(PRODUCT_IMAGE_BLOB_INDEX_URL, { access: 'public', token })
          const responseEtag = candidate?.headers.get('etag')?.replace(/^W\//, '')
          if (candidate && responseEtag === current.etag) currentBlob = candidate
          else await new Promise((resolve) => setTimeout(resolve, 5_000))
        }
        if (!currentBlob) throw new Error('Blob image index current version was not readable')
        const data = await new Response(currentBlob.stream).json()
        const images = data?.images && typeof data.images === 'object' ? { ...data.images } : {}
        if (imageUrl) images[skuCode] = imageUrl
        else delete images[skuCode]
        const blob = await put('products/catalog/image-index.json', Buffer.from(JSON.stringify({ version: new Date().toISOString(), images })), {
          access: 'public',
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: 'application/json',
          ifMatch: current.etag,
          token,
        })
        writeCommitted = true
        const committed = await head(PRODUCT_IMAGE_BLOB_INDEX_URL, { token })
        if (committed.etag !== blob.etag) throw new Error(`Blob image index ETag mismatch after committed write: ${skuCode}`)
        return
      } catch (error) {
        lastError = error
        if (writeCommitted) throw error
        if (attempt < 3) continue
      }
    }
    throw lastError
  })
  blobImageIndexUpdateQueue = operation.catch((error) => {
    console.warn('[products-notion] Blob image index projection update failed:', error)
  })
  await operation
}

async function markProductImageIndexDirty(skuCode: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const marked = await redis.eval(
      "if redis.call('exists', KEYS[1]) == 0 then redis.call('hset', KEYS[2], ARGV[1], ARGV[2]); return 1 else return 0 end",
      ['products:image-index:rebuild-lock', IMAGE_INDEX_DIRTY_KEY],
      [skuCode, new Date().toISOString()],
    )
    if (Number(marked) !== 1) throw new Error('產品圖片索引維護中，請稍後再儲存')
  } catch (error) {
    if (error instanceof Error && error.message.includes('索引維護中')) throw error
    throw new Error('產品圖片索引無法安全標記更新，已停止寫入', { cause: error })
  }
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
