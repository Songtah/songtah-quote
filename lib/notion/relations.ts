/**
 * lib/notion/relations.ts — 跨領域 relation 解析（relation page id → 名稱/資訊）
 *
 * tickets / visits 等多個領域都需要把客戶/產品的 relation id 解析成顯示名稱。
 * 這是跨切面基礎設施（只讀名稱、不含領域業務邏輯），獨立成一層，讓各葉領域都依賴它，
 * 避免 tickets ↔ visits ↔ customers 之間互相 import（違反「葉領域不互依」原則）。
 * 只 import shared，不 import 任何葉領域。
 */
import {
  notion, notionCallWithRetry, getCachedValue, setCachedValue,
  getTitle, getText, getSelect,
} from './shared'

/** Batch-fetch product names for a set of relation IDs (cached 10 min). */
export async function resolveProductNames(relIds: string[]): Promise<Record<string, string>> {
  const nameMap: Record<string, string> = {}
  const unique = Array.from(new Set(relIds.filter(Boolean)))
  if (!unique.length) return nameMap

  await Promise.all(
    unique.map(async (id) => {
      const cacheKey = `product-name:${id}`
      const cached = getCachedValue<string>(cacheKey)
      if (cached !== null) { nameMap[id] = cached; return }
      try {
        const page: any = await notionCallWithRetry('resolveProductName', () =>
          notion.pages.retrieve({ page_id: id })
        )
        const name = getTitle(page, 'Name') || getTitle(page, '產品名稱') || getTitle(page, '名稱')
        nameMap[id] = name
        setCachedValue(cacheKey, name, 600_000)
      } catch {
        nameMap[id] = ''
      }
    })
  )
  return nameMap
}

/** Batch-fetch customer info (name + city + district) for a set of relation IDs (cached 5 min). */
export async function resolveCustomerInfo(relIds: string[]): Promise<Record<string, { name: string; city: string; district: string }>> {
  const infoMap: Record<string, { name: string; city: string; district: string }> = {}
  const unique = Array.from(new Set(relIds.filter(Boolean)))
  if (!unique.length) return infoMap

  await Promise.all(
    unique.map(async (id) => {
      const cacheKey = `customer-info:${id}`
      const cached = getCachedValue<{ name: string; city: string; district: string }>(cacheKey)
      if (cached !== null) { infoMap[id] = cached; return }
      try {
        const page: any = await notionCallWithRetry('resolveCustomerInfo', () =>
          notion.pages.retrieve({ page_id: id })
        )
        const info = {
          name:     getTitle(page, '客戶名稱'),
          city:     getSelect(page, '縣市') || getText(page, '縣市') || '',
          district: getSelect(page, '行政區') || getText(page, '行政區') || '',
        }
        infoMap[id] = info
        setCachedValue(cacheKey, info, 300_000)
      } catch {
        infoMap[id] = { name: '', city: '', district: '' }
      }
    })
  )
  return infoMap
}

/** @deprecated Use resolveCustomerInfo instead */
export async function resolveCustomerNames(relIds: string[]): Promise<Record<string, string>> {
  const infoMap = await resolveCustomerInfo(relIds)
  return Object.fromEntries(Object.entries(infoMap).map(([id, v]) => [id, v.name]))
}
