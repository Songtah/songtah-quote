/**
 * Static product catalog loaded from public/products_catalog.json
 * and public/product_families.json.
 *
 * This replaces the Notion-based product search for the full 6 000+ SKU catalog.
 * Notion remains the source of truth for "rich" product pages (images, pricing, specs).
 */

import path from 'path'
import fs from 'fs'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CatalogProduct {
  code: string        // 貨品碼 / SKU code
  name: string        // 貨品名稱
  brand: string       // 品牌 / 生產商
  productType: string // 商品類型
  category: string    // 分類
  mainCategory?: string
  price?: number      // 售價（由產品價格主檔.xlsx 維護）
  salePrice?: number  // 優惠價
  spec?: string       // 技術規格摘要
  discontinued?: boolean
}

export interface SpecDefinition {
  key: string        // e.g. "直徑"
  label: string      // e.g. "直徑 (mm)"
  options: string[]  // e.g. ["95", "98"]
}

export interface ProductFamily {
  id: string          // unique family ID
  seriesCode: string  // code prefix, e.g. "BS-STML"
  seriesName: string  // display name, e.g. "3D Master 氧化鋯塊"
  brand: string
  productType: string
  category: string
  skuPattern: string  // template: "BS-STML-{直徑}H{厚度}-{顏色}"
  namePattern: string // template: "3D Master {直徑}H{厚度}-{顏色}"
  specs: SpecDefinition[]
  /** 貨品碼不規則時，用查表取代 pattern。key 格式：各規格值以 "|" 串接 */
  skuMap?: Record<string, string>
  /** 特殊 UI 變體（前端用）。'ymh-tooth-grid' = YAMAHACHI 牙型座標格 */
  uiVariant?: string
}

// ── Data loading (server-side, cached in module scope) ───────────────────────

function loadJson<T>(filename: string): T {
  const filePath = path.join(process.cwd(), 'public', filename)
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

let _catalog: CatalogProduct[] | null = null
let _families: ProductFamily[] | null = null

export function getCatalog(): CatalogProduct[] {
  if (!_catalog) _catalog = loadJson<CatalogProduct[]>('products_catalog.json')
  return _catalog
}

function getFamilies(): ProductFamily[] {
  if (!_families) _families = loadJson<ProductFamily[]>('product_families.json')
  return _families
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface CatalogSearchOptions {
  q?: string
  brand?: string
  productType?: string
  category?: string
  limit?: number
}

export function searchCatalog(opts: CatalogSearchOptions = {}): CatalogProduct[] {
  const { q = '', brand, productType, category, limit = 50 } = opts
  const keyword = q.trim().toLowerCase()

  let results = getCatalog()

  if (keyword) {
    results = results.filter(
      (p) =>
        p.code.toLowerCase().includes(keyword) ||
        p.name.toLowerCase().includes(keyword) ||
        p.brand.toLowerCase().includes(keyword)
    )
  }
  if (brand)       results = results.filter((p) => p.brand       === brand)
  if (productType) results = results.filter((p) => p.productType === productType)
  if (category)    results = results.filter((p) => p.category    === category)

  return results.slice(0, limit)
}

export function getCatalogProduct(code: string): CatalogProduct | undefined {
  return getCatalog().find((p) => p.code === code)
}

/** Returns all unique brands, productTypes, and categories from the catalog. */
export function getCatalogFilterOptions(): {
  brands: string[]
  productTypes: string[]
  categories: string[]
} {
  const all = getCatalog()
  return {
    brands:       Array.from(new Set(all.map((p) => p.brand).filter(Boolean))).sort(),
    productTypes: Array.from(new Set(all.map((p) => p.productType).filter(Boolean))).sort(),
    categories:   Array.from(new Set(all.map((p) => p.category).filter(Boolean))).sort(),
  }
}

// ── Families ─────────────────────────────────────────────────────────────────

export function getAllFamilies(): ProductFamily[] {
  return getFamilies()
}

/** Find the family whose seriesCode prefix matches a product code, if any. */
export function getFamilyByCode(code: string): ProductFamily | undefined {
  return getFamilies().find((f) => code.startsWith(f.seriesCode))
}

/** Build a SKU code from a family + selected spec values. */
export function buildSkuCode(family: ProductFamily, selections: Record<string, string>): string {
  let sku = family.skuPattern
  for (const [key, val] of Object.entries(selections)) {
    sku = sku.replace(`{${key}}`, val)
  }
  return sku
}

/** Build a display name from a family + selected spec values. */
export function buildSkuName(family: ProductFamily, selections: Record<string, string>): string {
  let name = family.namePattern
  for (const [key, val] of Object.entries(selections)) {
    name = name.replace(`{${key}}`, val)
  }
  return name
}
