/**
 * 一次性腳本：活動報名 DB 加上「地址」「行政區」（只增不改、不刪）。
 * 用途：匯入名單或報名表帶地址時，以縣市＋行政區確認客戶區域，降低同名機構配錯。
 * 用法：node scripts/setup-registration-address-fields.mjs          （dry-run）
 *       node scripts/setup-registration-address-fields.mjs --apply  （寫入 schema）
 */
import { Client } from '@notionhq/client'
import fs from 'fs'
import path from 'path'

const env = {}
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const apply = process.argv.includes('--apply')
const notion = new Client({ auth: env.NOTION_TOKEN })
const DB_ID = env.NOTION_REGISTRATIONS_DB || '39f9723b83ce44dab9b9348288814469'

const db = await notion.databases.retrieve({ database_id: DB_ID })
let count = 0, cursor
do {
  const r = await notion.databases.query({ database_id: DB_ID, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
  count += r.results.length
  cursor = r.has_more ? r.next_cursor : undefined
} while (cursor)
console.log(`活動報名 DB：現有 ${count} 筆資料（schema 只新增欄位，既有資料與欄位不變）`)

const props = {}
for (const k of ['地址', '行政區']) {
  if (db.properties[k]) console.log(`  = ${k} 已存在（${db.properties[k].type}），略過`)
  else { props[k] = { rich_text: {} }; console.log(`  + ${k}（rich_text）`) }
}
if (!Object.keys(props).length) { console.log('無需變更'); process.exit(0) }
if (!apply) { console.log('\n[dry-run] 未寫入。確認後加 --apply'); process.exit(0) }
await notion.databases.update({ database_id: DB_ID, properties: props })
const after = await notion.databases.retrieve({ database_id: DB_ID })
console.log('已寫入。read-back：', ['地址', '行政區'].map((k) => `${k}=${after.properties[k]?.type ?? '缺'}`).join('，'),
  '；既有欄位數', Object.keys(db.properties).length, '→', Object.keys(after.properties).length)
