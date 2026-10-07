import { Client } from '@notionhq/client'
import type { Product, Customer, Quote, QuoteItem } from '@/types'
import { getCatalogProduct } from '@/lib/products-catalog'
import { listProductPriceOverrides } from '@/lib/products-notion'
import { notionActiveCustomerClauses } from './customer-status'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const DB = {
  products:  process.env.NOTION_PRODUCTS_DB!,
  customers: process.env.NOTION_CUSTOMERS_DB!,
  quotes:    process.env.NOTION_QUOTES_DB!,
  items:     process.env.NOTION_ITEMS_DB!,
}

// ── helpers ──────────────────────────────────────────────────

function getText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const type = prop.type
  const val = prop[type]
  if (Array.isArray(val) && val.length > 0) return val[0].plain_text ?? ''
  if (type === 'url' && val) return val
  return ''
}

function getNumber(page: any, field: string): number | null {
  return page.properties?.[field]?.number ?? null
}

function getSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function getCheckbox(page: any, field: string): boolean {
  return page.properties?.[field]?.checkbox ?? false
}

function getDate(page: any, field: string): string {
  return page.properties?.[field]?.date?.start ?? ''
}

function getUniqueId(page: any, field: string): number {
  return page.properties?.[field]?.unique_id?.number ?? 0
}

function getCreatedTime(page: any, field: string): string {
  return page.properties?.[field]?.created_time ?? ''
}

function getFileUrl(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  if (prop.type === 'files') {
    const files: any[] = prop.files ?? []
    if (files.length === 0) return ''
    const f = files[0]
    return f.type === 'external' ? (f.external?.url ?? '') : (f.file?.url ?? '')
  }
  if (prop.type === 'url') return prop.url ?? ''
  return ''
}

function richText(content: string) {
  return [{ text: { content } }]
}

// ── products ─────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const pages: any[] = []
  let cursor: string | undefined

  do {
    const resp: any = await notion.databases.query({
      database_id: DB.products,
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    pages.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)

  const priceOverrides = await listProductPriceOverrides()

  return pages.map((p) => {
    // Title field is 'Name' in this DB
    let name = ''
    for (const val of Object.values(p.properties ?? {}) as any[]) {
      if (val.type === 'title') {
        name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
        break
      }
    }
    const skuCode = getText(p, '貨號')
    const catalog = skuCode ? getCatalogProduct(skuCode) : undefined
    return {
      id:       p.id,
      name,
      brand:    getSelect(p, '生產商'),
      category: getSelect(p, '分類'),
      spec:     getSelect(p, '商品類型'),
      unit:     '個',
      price:    skuCode
        ? priceOverrides[skuCode] ?? catalog?.price ?? null
        : getNumber(p, '價格'),
      series:   '',
      active:   !getCheckbox(p, '中央停用') && !catalog?.discontinued,
      imageUrl: '',
    }
  }).filter((product) => product.active)
}

// ── customers ────────────────────────────────────────────────

export async function searchCustomers(query: string): Promise<Customer[]> {
  if (!query || query.trim().length < 1) return []

  const resp: any = await notion.databases.query({
    database_id: DB.customers,
    filter: {
      and: [
        { property: '客戶名稱', title: { contains: query.trim() } },
        // 報價/訂貨不該選到無效機構;口徑與轄區、監控一致(原本只排除已歇業)
        ...notionActiveCustomerClauses(),
      ],
    },
    sorts: [{ property: '客戶名稱', direction: 'ascending' }],
    page_size: 20,
  })

  return resp.results.map((p: any) => ({
    id:      p.id,
    name:    getText(p, '客戶名稱'),
    address: getText(p, '地址'),
    phone:   p.properties?.['電話']?.phone_number ?? '',
    taxId:   getText(p, '統一編號'),
    city:    getSelect(p, '縣市'),
    type:    getSelect(p, '客戶類型'),
    status:  getSelect(p, '機構狀態'),
  }))
}

// ── quotes：已抽到 lib/notion/quotes.ts（2026-10-07），此處轉出口維持既有 import 路徑 ──
export { createQuote, updateQuote, listQuotes, listQuotesByCustomer, getQuote, updateQuoteStatus, deleteQuote } from './notion/quotes'
