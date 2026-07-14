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
  productType: string // 商品型態(9 種,見 data/product-taxonomy.json)
  category: string    // 功能分類(62 種)
  mainCategory?: string   // 主分類(11 種)
  mainCategoryId?: string // 主分類英文 slug(官網 URL/程式判斷用)
  categoryId?: string     // 功能分類英文 slug
  seriesName?: string     // 總表系列名稱(如「EFC-A 塑鋼前齒」)
  needsReview?: boolean   // 總表待覆核/未判定旗標
  price?: number      // 售價（由產品價格主檔.xlsx 維護）
  salePrice?: number  // 優惠價
  spec?: string       // 技術規格摘要
  discontinued?: boolean  // 已停售／未販售 → 訂貨/報價選品器不顯示
  status?: string         // 銷售狀態：已停售／未販售（discontinued 為 true 時的細分）
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

  // 訂貨/報價選品器不顯示已停售／未販售品項（管理頁仍可見，走 getCatalog）
  let results = getCatalog().filter((p) => !p.discontinued)

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

// ── Taxonomy(主分類→功能分類 主樹,源自 data/product-taxonomy.json)────────────

export interface TaxonomyFunc { id: string; name: string; count: number }
export interface TaxonomyMain { id: string; name: string; count: number; funcs: TaxonomyFunc[] }
export interface TaxonomyBrowser {
  version: string
  mains: TaxonomyMain[]                      // 11 主分類(字典順序),含各自完整功能分類與 SKU 數
  productForms: { name: string; count: number }[]  // 9 商品型態
}

interface TaxonomyDict {
  version: string
  mainCategories: { id: string; name: string }[]
  funcCategories: { id: string; name: string; mainId: string; mainName: string }[]
  productForms: { id: string; name: string }[]
}

let _taxonomy: TaxonomyDict | null = null
function getTaxonomyDict(): TaxonomyDict {
  if (!_taxonomy) {
    const filePath = path.join(process.cwd(), 'data', 'product-taxonomy.json')
    _taxonomy = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TaxonomyDict
  }
  return _taxonomy
}

/** 主分類→功能分類完整主樹 + 各層 SKU 數(商品目錄管理頁「分類完整呈現」用)。 */
export function getTaxonomyBrowser(): TaxonomyBrowser {
  const dict = getTaxonomyDict()
  const all = getCatalog()
  const catCount = new Map<string, number>()
  const mainCount = new Map<string, number>()
  const formCount = new Map<string, number>()
  for (const p of all) {
    if (p.category) catCount.set(p.category, (catCount.get(p.category) ?? 0) + 1)
    if (p.mainCategory) mainCount.set(p.mainCategory, (mainCount.get(p.mainCategory) ?? 0) + 1)
    if (p.productType) formCount.set(p.productType, (formCount.get(p.productType) ?? 0) + 1)
  }
  const mains: TaxonomyMain[] = dict.mainCategories.map((m) => ({
    id: m.id,
    name: m.name,
    count: mainCount.get(m.name) ?? 0,
    funcs: dict.funcCategories
      .filter((f) => f.mainId === m.id)
      .map((f) => ({ id: f.id, name: f.name, count: catCount.get(f.name) ?? 0 }))
      .sort((a, b) => b.count - a.count),
  }))
  // 有商品的主分類排前(依 SKU 數),空的(如技術服務)沉底但仍完整呈現
  mains.sort((a, b) => b.count - a.count)
  return {
    version: dict.version,
    mains,
    productForms: dict.productForms.map((f) => ({ name: f.name, count: formCount.get(f.name) ?? 0 })),
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
