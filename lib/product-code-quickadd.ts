/**
 * lib/product-code-quickadd.ts —— 報價單／訂貨單「打貨號直接加入」（前端共用）
 *
 * 2026-10-21 使用者回報：報價單、訂貨單沒辦法直接打產品編號。搜尋本來就比對貨號，
 * 但要在結果裡找到那一筆再按「加入」；連續輸入多個貨號時很慢。這裡讓搜尋框：
 *   - 輸入完整貨號按 Enter → 直接加入（大小寫、連字號、空白不拘：zzzbcd0933 = ZZ-ZBCD0933）
 *   - 一次貼上多個貨號（換行、逗號、空白分隔）按 Enter → 整批加入，對不到的列出來
 * 只有「完全對到貨號」才加，避免加錯品項；不像貨號的關鍵字照常顯示搜尋結果。
 */

export type CodeLookupHit = { skuCode: string }

/** 貨號比對用：全形轉半形、轉大寫、去掉空白與 - _ / . */
export const normalizeCode = (s: string) => (s ?? '').normalize('NFKC').toUpperCase().replace(/[\s\-_/.]/g, '')

/** 像貨號：英數為主（可含 - / _ .）、至少 3 碼、含數字、沒有中文 */
const looksLikeCode = (s: string) =>
  /^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,}$/.test(s) && /\d/.test(s) && !/[一-龥]/.test(s)

/** 搜尋框內容拆成貨號清單；只要有一段不像貨號就回 []（當一般關鍵字處理） */
export function parseCodeInput(input: string): string[] {
  const parts = (input ?? '').normalize('NFKC').split(/[\s,，、;；]+/).map((x) => x.trim()).filter(Boolean)
  if (!parts.length || !parts.every(looksLikeCode)) return []
  return Array.from(new Set(parts))
}

/** 逐一查貨號，只收完全相符者 */
export async function lookupProductCodes<T extends CodeLookupHit>(codes: string[]): Promise<{ found: T[]; missing: string[] }> {
  const found: T[] = []
  const missing: string[] = []
  await Promise.all(codes.map(async (code) => {
    try {
      const res = await fetch(`/api/products/search?limit=5&q=${encodeURIComponent(code)}`)
      const list: T[] = res.ok ? await res.json() : []
      const hit = list.find((p) => normalizeCode(p.skuCode) === normalizeCode(code))
      if (hit) found.push(hit)
      else missing.push(code)
    } catch {
      missing.push(code)
    }
  }))
  // 照輸入順序加入
  const order = new Map(codes.map((c, i) => [normalizeCode(c), i]))
  found.sort((a, b) => (order.get(normalizeCode(a.skuCode)) ?? 0) - (order.get(normalizeCode(b.skuCode)) ?? 0))
  return { found, missing }
}

export function quickAddMessage(added: number, missing: string[]): string {
  const parts: string[] = []
  if (added) parts.push(`已加入 ${added} 項`)
  if (missing.length) parts.push(`查無貨號：${missing.join('、')}`)
  return parts.join('；')
}
