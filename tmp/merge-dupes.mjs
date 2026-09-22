// 合併「可安全合併」的同名重複客戶：缺漏欄位補到保留者，再封存待刪者。
// 預設預覽；--apply 才寫入。封存前必檢查待刪者沒有拜訪關聯。
import { Client } from '@notionhq/client'
import fs from 'fs'
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const APPLY = process.argv.includes('--apply')

const safe = JSON.parse(fs.readFileSync(SP + '/dedupe.json', 'utf8')).safe
const pairs = new Map()
for (const r of safe) {
  const k = r['客戶名稱'].replace(/台/g, '臺') + '|' + r['縣市'] + '|' + r['地址'].replace(/[\s台臺]/g, '')
  const g = pairs.get(k) ?? { keep: null, drop: [] }
  if (r['處置'] === '保留') g.keep = r; else g.drop.push(r)
  pairs.set(k, g)
}

const uuid = (id) => id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const val = (p) => { const v = p?.[p?.type]; return Array.isArray(v) ? (v.length ? v : null) : (v === '' || v === false ? null : v) }

for (const [, g] of pairs) {
  if (!g.keep || !g.drop.length) { console.log('略過（找不到成對）', g); continue }
  const keepPage = await notion.pages.retrieve({ page_id: uuid(g.keep.NotionID) })
  console.log(`\n【${g.keep['客戶名稱']}】保留 ${g.keep.NotionID.slice(0, 8)}…（${g.keep['地址']}）`)
  for (const d of g.drop) {
    const dropPage = await notion.pages.retrieve({ page_id: uuid(d.NotionID) })
    const rel = dropPage.properties['Related to 拜訪紀錄 (診所)']?.relation ?? []
    if (rel.length) { console.log(`  ⚠️ ${d.NotionID.slice(0, 8)}… 有 ${rel.length} 筆拜訪關聯，跳過不刪`); continue }
    const patch = {}
    for (const [k, v] of Object.entries(dropPage.properties)) {
      if (k === '客戶名稱' || v.type === 'formula' || v.type === 'relation' || v.type === 'rollup') continue
      if (val(keepPage.properties[k]) === null && val(v) !== null) {
        patch[k] = { [v.type]: v[v.type] }
      }
    }
    console.log(`  刪除 ${d.NotionID.slice(0, 8)}…（${d['地址']}）；補到保留者的欄位：${Object.keys(patch).join('、') || '無'}`)
    if (!APPLY) continue
    if (Object.keys(patch).length) await notion.pages.update({ page_id: uuid(g.keep.NotionID), properties: patch })
    await notion.pages.update({ page_id: uuid(d.NotionID), archived: true })
    console.log('    ✓ 已補欄位並封存')
  }
}
console.log(APPLY ? '\n完成' : '\n預覽模式，未寫入。加 --apply 執行。')
