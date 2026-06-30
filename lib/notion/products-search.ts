/**
 * lib/notion/products-search.ts — 產品（Notion 產品庫）搜尋與分類（葉領域）
 * 供報價/訂貨選品器與分類篩選使用；與 products-catalog.ts（靜態目錄）為不同來源。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getCachedValue, setCachedValue, getText, getSelect,
} from './shared'

export type ProductItem = {
  id: string
  name: string
  manufacturer: string    // 生產商
  productType: string     // 商品類型 (軟體/設備/材料/耗材)
  category: string        // 分類 (研磨機/鋯塊/…)
  price: number | null    // 價格
  salePrice: number | null // 優惠價
  notes: string           // 備註
  weight: number | null   // 重量 (kg)
  // Technical specs
  bendingStrength: string     // 彎曲強度
  transparency: string        // 材料透度
  sinteringTemp: string       // 燒結溫度
  bendingModulus: string      // 彎曲模數 (Mpa)
  flexuralStrength: string    // 抗彎強度 (MPa)
  tensileStrength: string     // 抗拉強度 (MPa)
  elongation: string          // 拉伸伸長率
  hardness: string            // 硬度
  workingDistance: string     // 工作距離
  fieldWidth: string          // 景寬
  fieldDepth: string          // 景深
}

function getProductNumber(page: any, field: string): number | null {
  const v = page.properties?.[field]?.number
  return v == null ? null : v
}

// Fetches all products (cached 60 s) and returns them; caller can filter client-side.
async function getAllProducts(): Promise<ProductItem[]> {
  if (!DB.products) return []
  const cacheKey = 'products:all'
  const cached = getCachedValue<ProductItem[]>(cacheKey)
  if (cached) return cached

  const response: any = await notionCallWithRetry('getAllProducts', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.products!),
      page_size: 100,
    })
  )

  const items = (response.results ?? []).map((page: any) => {
    // Title field is called 'Name' in this DB
    let name = ''
    for (const val of Object.values(page.properties ?? {}) as any[]) {
      if (val.type === 'title') {
        name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
        break
      }
    }
    return {
      id: page.id,
      name,
      manufacturer: getSelect(page, '生產商'),
      productType: getSelect(page, '商品類型'),
      category: getSelect(page, '分類'),
      price: getProductNumber(page, '價格'),
      salePrice: getProductNumber(page, '優惠價'),
      notes: getText(page, '備註'),
      weight: getProductNumber(page, '重量 (kg)'),
      bendingStrength: getText(page, '彎曲強度'),
      transparency: getText(page, '材料透度'),
      sinteringTemp: getText(page, '燒結溫度'),
      bendingModulus: getText(page, '彎曲模數 (Mpa)'),
      flexuralStrength: getText(page, '抗彎強度 (MPa)'),
      tensileStrength: getText(page, '抗拉強度 (MPa)'),
      elongation: getText(page, '拉伸伸長率'),
      hardness: getText(page, '硬度'),
      workingDistance: getText(page, '工作距離'),
      fieldWidth: getText(page, '景寬'),
      fieldDepth: getText(page, '景深'),
    }
  })

  setCachedValue(cacheKey, items, 600_000) // 10 min
  return items
}

export async function searchProducts(query: string): Promise<ProductItem[]> {
  const all = await getAllProducts()
  const keyword = query.trim().toLowerCase()
  if (!keyword) return all
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(keyword) ||
      p.manufacturer.toLowerCase().includes(keyword) ||
      p.category.toLowerCase().includes(keyword) ||
      p.productType.toLowerCase().includes(keyword)
  )
}

export async function getProductCategories(): Promise<{ brands: string[]; types: string[]; categories: string[] }> {
  const all = await getAllProducts()
  const brands     = Array.from(new Set(all.map((p) => p.manufacturer).filter(Boolean))).sort() as string[]
  const types      = Array.from(new Set(all.map((p) => p.productType).filter(Boolean))).sort() as string[]
  const categories = Array.from(new Set(all.map((p) => p.category).filter(Boolean))).sort() as string[]
  return { brands, types, categories }
}
