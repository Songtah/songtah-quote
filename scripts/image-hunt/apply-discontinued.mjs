// 產品圖片覆核順便標記的「未販售/停售」→ 合併回 products_catalog.json(dry-run 預設)
// 用法:node scripts/image-hunt/apply-discontinued.mjs [--write]
// 來源:decisions.json 中 discontinued:true 的項目(review-server.mjs 覆核頁「🚫 標記未販售/停售」按鈕)
// 動作:
//   group 目標 → memberCodes 全部標 discontinued:true, status:'未販售(圖片覆核標記)'
//   series 目標 → catalog 中 code 以該系列代碼開頭者全部比照辦理
//   只新增/更新這兩欄,不動 price 等其他欄位;已是 discontinued 的略過(冪等)
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const WRITE = process.argv.includes('--write')
const CATALOG_PATH = path.join(ROOT, 'public/products_catalog.json')

const decisions = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'decisions.json'), 'utf8'))
const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))
const targetById = new Map(targets.map((t) => [t.id, t]))
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
const byCode = new Map(catalog.map((p) => [p.code, p]))

const marked = Object.entries(decisions).filter(([, d]) => d.discontinued)
console.log(`${WRITE ? '【寫入模式】' : '【dry-run】'} 待處理未販售標記 ${marked.length} 筆`)

let touched = 0, alreadyDiscontinued = 0, missing = 0
const changedCodes = []

for (const [id, d] of marked) {
  const t = targetById.get(id)
  if (!t) { console.log(`! ${id} 不在 targets.json,跳過`); missing++; continue }
  const codes = t.kind === 'group' ? (t.memberCodes || []) : catalog.filter((p) => p.code.startsWith(t.code)).map((p) => p.code)
  for (const code of codes) {
    const p = byCode.get(code)
    if (!p) { missing++; continue }
    if (p.discontinued) { alreadyDiscontinued++; continue }
    changedCodes.push(code)
    if (WRITE) { p.discontinued = true; p.status = '未販售(圖片覆核標記)' }
    touched++
  }
  console.log(`✓ ${t.kind === 'series' ? '系列' : '組'} ${t.code}「${t.name}」→ ${codes.length} SKU`)
}

console.log(`合計:標記 ${touched} 筆 SKU 為未販售、已是停售略過 ${alreadyDiscontinued}、找不到貨號 ${missing}`)
if (touched && WRITE) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2))
  console.log(`已寫入 ${CATALOG_PATH}`)
  console.log('提醒:記得跑 python3 scripts/validate_categories.py 驗證,並 git commit + push 部署')
} else if (touched) {
  console.log('前 20 筆將受影響的貨號:', changedCodes.slice(0, 20).join(', '))
  console.log('確認無誤後加 --write 真正寫入')
}
