/**
 * 原廠連結（產品專屬頁的「原廠產品頁／原廠官網」按鈕）。
 * 資料在 data/catalog/official_links.json：products＝貨號對得上的原廠產品頁，brands＝品牌官網首頁。
 * 只回 http(s) 網址；沒有就回 null，前端不顯示按鈕。
 */
import 'server-only'
import fs from 'fs'
import path from 'path'

type OfficialLinks = { brands: Record<string, string>; products: Record<string, string> }
let cache: OfficialLinks | null = null

function load(): OfficialLinks {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog', 'official_links.json'), 'utf-8'))
    cache = { brands: raw.brands ?? {}, products: raw.products ?? {} }
  } catch {
    cache = { brands: {}, products: {} }
  }
  return cache
}

const safe = (url?: string) => (url && /^https?:\/\//.test(url) ? url : '')

export function officialLinkFor(code: string, brand: string): { url: string; kind: 'product' | 'brand' } | null {
  const links = load()
  const product = safe(links.products[code])
  if (product) return { url: product, kind: 'product' }
  const site = safe(links.brands[brand])
  return site ? { url: site, kind: 'brand' } : null
}
