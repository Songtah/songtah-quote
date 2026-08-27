// 產品圖片獵取共用:從商品名辨識顏色/牙色與容量、重量、尺寸單位,供 match.mjs 比對加分用
// 牙色代碼(A1-D4/BL1-4/OM1-3…)+ 常見顏色詞(中英) + 容量/重量/尺寸(50ml、1kg、10mm…)

const SHADE_RE = /\b(?:OM|BL|ND|[A-D])\d(?:\.\d)?\b/gi

const COLOR_WORDS = [
  '透明', '粉紅', '粉色', '白', '黑', '藍', '黃', '紅', '綠', '灰', '米', '棕', '咖啡', '銀', '金',
  '橘', '橙', '紫', '青', '卡其', '奶油',
  'white', 'black', 'clear', 'transparent', 'pink', 'blue', 'yellow', 'red', 'green',
  'grey', 'gray', 'ivory', 'natural', 'universal', 'multi', 'silver', 'gold', 'brown',
  'orange', 'purple', 'violet', 'cyan', 'beige', 'cream', 'turquoise', 'maroon', 'navy',
]

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(ml|ML|mL|l|L|g|G|kg|Kg|KG|mm|MM|cm|CM|支|入|片|條|包|組|桶|罐|瓶|盒)/g

export function extractAttrs(name) {
  if (!name) return { colors: [], sizes: [] }
  const colors = new Set()
  for (const m of name.matchAll(SHADE_RE)) colors.add(m[0].toUpperCase())
  const lower = name.toLowerCase()
  for (const w of COLOR_WORDS) if (lower.includes(w.toLowerCase())) colors.add(w)
  const sizes = new Set()
  for (const m of name.matchAll(SIZE_RE)) sizes.add(`${m[1]}${m[2].toLowerCase()}`)
  return { colors: [...colors], sizes: [...sizes] }
}
