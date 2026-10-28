/**
 * lib/product-spec-lines.ts —— 報價單選產品時自動帶入的「規格」文字（逐行，2026-10-28 使用者定案）
 *
 * 來源優先序：
 *   1. 產品後台「技術規格」表（Notion，中央管理維護）：每列一行「項目：值」
 *   2. 系列規格矩陣（data/catalog/product_families.json）：該貨號的規格選項，每項一行「顏色：A1」
 *   3. 都沒有：回空陣列，前端沿用產品類型
 * 只帶入、不鎖定：報價單上可以自由修改或刪除。
 */
import 'server-only'
import { getAllFamilies } from '@/lib/products-catalog'
import { getProductRichData } from '@/lib/products-notion'

function techSpecLines(specsJson: string): string[] {
  try {
    const t = JSON.parse(specsJson)
    const rows: unknown[][] = Array.isArray(t?.rows) ? t.rows : []
    return rows
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r[0] && r.slice(1).some(Boolean))
      .map((r) => `${r[0]}：${r.slice(1).filter(Boolean).join(' / ')}`)
  } catch {
    return []
  }
}

function variantLines(code: string): string[] {
  for (const f of getAllFamilies()) {
    const entry = Object.entries((f as any).skuMap ?? {}).find(([, c]) => c === code)
    if (!entry) continue
    const values = entry[0].split('|')
    return f.specs.map((s, i) => (values[i] ? `${s.label}：${values[i]}` : '')).filter(Boolean)
  }
  return []
}

export async function productSpecLines(code: string): Promise<string[]> {
  const rich = await getProductRichData(code).catch(() => null)
  const tech = rich?.specsJson ? techSpecLines(rich.specsJson) : []
  return tech.length ? tech : variantLines(code)
}
