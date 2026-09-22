// 指定一組：把待刪筆的缺漏欄位補到保留筆，再封存待刪筆。--apply 才寫入。
import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const APPLY = process.argv.includes('--apply')
const uuid = (id) => id.replace(/-/g, '').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const KEEP = uuid(process.argv[2])
const DROP = uuid(process.argv[3])

const val = (p) => { const v = p?.[p?.type]; return Array.isArray(v) ? (v.length ? v : null) : (v === '' || v === false ? null : v) }
const name = (p) => (p.properties['客戶名稱']?.title ?? []).map((t) => t.plain_text).join('')
const addr = (p) => (p.properties['地址']?.rich_text ?? []).map((t) => t.plain_text).join('')

const keep = await notion.pages.retrieve({ page_id: KEEP })
const drop = await notion.pages.retrieve({ page_id: DROP })
console.log('保留：', name(keep), '｜', addr(keep))
console.log('刪除：', name(drop), '｜', addr(drop))

const rel = drop.properties['Related to 拜訪紀錄 (診所)']?.relation ?? []
if (rel.length) { console.log(`⚠️ 待刪筆有 ${rel.length} 筆拜訪關聯，中止`); process.exit(1) }

const patch = {}
for (const [k, v] of Object.entries(drop.properties)) {
  if (k === '客戶名稱' || ['formula', 'relation', 'rollup'].includes(v.type)) continue
  if (val(keep.properties[k]) === null && val(v) !== null) patch[k] = { [v.type]: v[v.type] }
}
console.log('要補到保留筆的欄位：', Object.keys(patch).join('、') || '無')
if (!APPLY) { console.log('預覽模式，未寫入。'); process.exit(0) }
if (Object.keys(patch).length) await notion.pages.update({ page_id: KEEP, properties: patch })
await notion.pages.update({ page_id: DROP, archived: true })
console.log('✓ 已補欄位並封存')
