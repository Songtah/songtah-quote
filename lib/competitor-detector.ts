/**
 * 從拜訪內文中偵測競品關鍵字，對應到 Notion 競品欄位的 multi_select 選項。
 *
 * 兩層比對：
 *   1. Notion 選項名稱直接比對（不分大小寫）
 *   2. 自訂別名表（ALIASES）— 品牌縮寫、英文大小寫變體等
 *
 * 新增競品：
 *   - 若已在 Notion 競品欄位建立選項，下次掃描自動生效
 *   - 若需要別名（如「3 M」→「3M」），在 ALIASES 裡加一行即可
 */

/**
 * 別名對應表：keyword → Notion option 名稱
 * key   = 要在內文中搜尋的字串（不分大小寫）
 * value = Notion multi_select 中完整的選項名稱（需完全一致）
 *
 * 範例：
 *   '3 m':   '3M',       ← 內文寫「3 M」也能對到「3M」
 *   'kerr':  'KERR',     ← 不分大小寫
 */
const ALIASES: Record<string, string> = {
  // ── 在此新增別名 ──────────────────────────────────────────────
  // '別名': 'Notion選項名稱',
}

/**
 * 偵測內文中提到的競品，回傳符合 Notion 選項名稱的陣列。
 *
 * @param content       拜訪紀錄的文字內容（可多段合併）
 * @param notionOptions Notion 競品欄位的 multi_select 選項名稱清單
 * @returns             匹配到的 Notion 選項名稱（不重複）
 */
export function detectCompetitors(
  content: string,
  notionOptions: string[]
): string[] {
  if (!content || !notionOptions.length) return []

  const text  = content.toLowerCase()
  const found = new Set<string>()

  // 1. Notion 選項直接比對（全字或詞匹配，避免「GC」誤中「CGS」）
  for (const option of notionOptions) {
    if (!option) continue
    const kw = option.toLowerCase()
    // 用詞邊界避免誤判：前後接非字母數字，或字串首尾
    const regex = new RegExp(
      `(?<![\\w\\u4e00-\\u9fff])${escapeRegex(kw)}(?![\\w\\u4e00-\\u9fff])`,
      'i'
    )
    if (regex.test(text)) found.add(option)
  }

  // 2. 自訂別名
  for (const [alias, optionName] of Object.entries(ALIASES)) {
    if (!notionOptions.includes(optionName)) continue   // 選項不存在就跳過
    const regex = new RegExp(
      `(?<![\\w\\u4e00-\\u9fff])${escapeRegex(alias)}(?![\\w\\u4e00-\\u9fff])`,
      'i'
    )
    if (regex.test(text)) found.add(optionName)
  }

  return Array.from(found)
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
