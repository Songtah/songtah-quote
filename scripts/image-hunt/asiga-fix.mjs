// ASIGA 品牌發現的資料缺口:product_families.json 有 6 個「幽靈系列」
// (AG-3D-PRINTER/AG-POST-CURING/AG-PRINT-RESIN/AG-PRINT-CONSUMABLE/AG-PRINTER-ACCESSORY/AG-SPARE-PART,
//  seriesCode 是敘述性文字不是真貨號前綴)佔用了 coveredSkuCodes,導致 71 個真實 ASIGA SKU
// 在 build-targets.mjs 的 inFamily() 判斷中被排除、卻又沒被計入該系列成員數 —— 整批消失於 targets.json。
// 這是分類資料本身的 bug,不動 product_families.json(正式系統設定),只在圖片獵取這一步繞過,
// 直接把 71 個 SKU 依品名分組建立臨時比對目標,寫回 targets.json 補上。
import fs from 'fs'
import path from 'path'

const ROOT = '/Users/ted/Desktop/Songtah/quote-system'
const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/products_catalog.json'), 'utf8'))
const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))

const asiga = catalog.filter((p) => p.brand === 'ASIGA' && !p.discontinued && p.productType !== '維修料件' && p.productType !== '待確認')

function englishHints(name) {
  const runs = name.match(/[A-Za-z][A-Za-z0-9 .\-\/+&']{2,}/g) || []
  return runs.map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s.length >= 3 && !/^\d/.test(s)).slice(0, 3)
}
function groupKey(name) {
  let s = name.replace(/[((][^))]*[))]/g, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:ml|mL|L|g|kg|Kg|mm|cm|pcs|支|入|片|條|包|組|桶|罐|瓶|盒)\b/gi, ' ').replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return s
}

const groups = new Map()
for (const p of asiga) {
  const key = groupKey(p.name)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(p)
}

let n = 0
const newTargets = []
for (const [key, members] of groups) {
  const rep = members[0]
  newTargets.push({
    id: `asigafix:${String(++n).padStart(3, '0')}`,
    kind: 'group',
    groupKey: `ASIGA::${key}`,
    code: rep.code,
    name: rep.name,
    brand: 'ASIGA',
    category: rep.category,
    hints: englishHints(rep.name),
    memberCodes: members.map((m) => m.code),
    priority: 'high',
  })
}

const merged = [...targets, ...newTargets]
fs.writeFileSync(path.join(WORKSPACE, 'targets.json'), JSON.stringify({ generatedAt: new Date().toISOString(), targets: merged }, null, 1))
console.log(`補上 ${newTargets.length} 個 ASIGA 臨時目標,覆蓋 ${asiga.length} 個 SKU`)
