// 產品圖片獵取:第一步 — 產出目標清單 targets.json
// 規則(2026-07-15 使用者拍板):
//   維修料件/待確認/已停售 → 排除;耗材 → low(有就有);系列 → high;其餘散裝 → normal
// 用法:node scripts/image-hunt/build-targets.mjs
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { extractAttrs } from './attrs.mjs'

const ROOT = process.cwd()
const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/products_catalog.json'), 'utf8'))
const families = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/product_families.json'), 'utf8'))

// 系列成員判定:只認明確列出的 SKU(coveredSkuCodes / skuMap 值)。
// 2026-07-21 修正:原本多加了「貨號開頭跟系列代碼一樣就算」的 prefix fallback,
// 但正式前端邏輯(lib/product-family-members.ts)明確拒絕這樣做——
// 「系列歸屬只接受明確列出的 SKU。不使用 seriesCode prefix,避免同前綴的不同產品被錯併成同系列。」
// 實測這條 prefix 規則曾把研磨機、刷子、金屬棒之類完全無關的品項錯併進其他系列(130 個 SKU 中槍)。
// 拿掉 fallback,改成跟正式系統完全一致的明確清單比對。
const covered = new Set()
for (const f of families) {
  for (const c of f.coveredSkuCodes || []) covered.add(c)
  for (const v of Object.values(f.skuMap || {})) covered.add(v)
}
const inFamily = (code) => covered.has(code)

// 品名抽英文搜尋詞:連續 ASCII 詞組(含 - / .),過濾純數字與尺寸片段
function englishHints(name) {
  const runs = name.match(/[A-Za-z][A-Za-z0-9 .\-\/+&']{2,}/g) || []
  return runs
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length >= 3 && !/^\d/.test(s) && !/^(mm|cm|kg|pcs|set)$/i.test(s))
    .slice(0, 3)
}

const targets = []

for (const f of families) {
  // 這個系列自己的明確成員清單(不靠 prefix),同上面 inFamily 的修正原則
  const ownCodes = new Set([...(f.coveredSkuCodes || []), ...Object.values(f.skuMap || {})])
  targets.push({
    id: `series:${f.id}`,
    kind: 'series',
    code: f.seriesCode,
    familyId: f.id,
    name: f.seriesName,
    brand: f.brand,
    hints: englishHints(`${f.seriesName} ${f.skuPattern || ''}`),
    attrs: extractAttrs(f.seriesName),
    memberCount: catalog.filter((p) => ownCodes.has(p.code)).length,
    priority: 'high',
  })
}

// 散裝同名分組:去掉色號/容量/尺寸後同名的變體共用一張圖(同瓶不同色)
function groupKey(brand, name) {
  let s = name
    .replace(/[((][^))]*[))]/g, ' ')                       // 括號內容(容量/備註)
    .replace(/\b(?:OM|BL|ND|A|B|C|D)\d(?:\.\d)?\b/gi, ' ')   // 牙色 A1-D4/OM1/BL2…
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|mL|L|g|kg|Kg|mm|cm|pcs|支|入|片|條|包|組|桶|罐|瓶|盒)\b/gi, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/[\/·xX*×]\s*\d+\S*/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return `${brand}::${s}`
}

let excluded = 0
const groups = new Map()
for (const p of catalog) {
  if (inFamily(p.code)) continue
  if (p.discontinued || p.productType === '維修料件' || p.productType === '待確認') { excluded++; continue }
  const key = groupKey(p.brand, p.name)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(p)
}
// group id 改用內容雜湊(取代原本的 Map 迭代序號)。
// 2026-07-21 修正:序號式 id 完全看這次跑出來哪些 SKU 進了分組迴圈,只要上游成員池有任何變動
// (例如這次修 inFamily prefix bug),幾乎所有 group id 都會整批錯位,已核對的 decisions.json 會全部對不上。
// 雜湊只吃 groupKey(品牌+去色號容量後的品名),同一個產品家族不管池子怎麼變動,id 永遠一樣。
function groupId(key) {
  return `group:${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`
}
for (const [key, members] of groups) {
  const rep = members[0]
  targets.push({
    id: groupId(key),
    kind: 'group',
    groupKey: key,
    code: rep.code,
    name: rep.name,
    brand: rep.brand,
    category: rep.category,
    hints: englishHints(rep.name),
    attrs: extractAttrs(rep.name),
    memberCodes: members.map((m) => m.code),
    priority: members.every((m) => m.productType === '耗材') ? 'low' : 'normal',
  })
}

fs.mkdirSync(WORKSPACE, { recursive: true })
fs.writeFileSync(path.join(WORKSPACE, 'targets.json'), JSON.stringify({ generatedAt: new Date().toISOString(), targets }, null, 1))

const stat = (k) => targets.filter((t) => t.priority === k).length
const nGroups = targets.filter((t) => t.kind === 'group')
const nCovered = nGroups.reduce((s, t) => s + t.memberCodes.length, 0)
console.log(`targets: ${targets.length}(series ${targets.filter((t) => t.kind === 'series').length} / group ${nGroups.length} 覆蓋 ${nCovered} SKU);排除 ${excluded};low ${stat('low')}`)
const byBrand = {}
for (const t of targets) byBrand[t.brand] = (byBrand[t.brand] || 0) + 1
console.log('目標品牌分布:', Object.entries(byBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(' | '))
