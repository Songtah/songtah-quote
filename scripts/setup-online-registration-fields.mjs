/**
 * 一次性腳本：線上課程報名頁所需欄位（只增不改、不刪；select 既有選項原樣保留）。
 * 用法：node scripts/setup-online-registration-fields.mjs          （dry-run）
 *       node scripts/setup-online-registration-fields.mjs --apply  （寫入 schema）
 *
 * 活動管理 DB：線上報名(checkbox) 收費(checkbox) 報名費(number) 付款說明(text) 廣告圖(url) 名額(number)
 * 活動報名 DB：職稱(text) 單位類型(select) 付款狀態(select) 應繳金額(number)
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
const EVENTS = env.NOTION_EVENTS_DB || '36dc5ca6467a46c299e2fe6efe5ab05e'
const REGS = env.NOTION_REGISTRATIONS_DB || '39f9723b83ce44dab9b9348288814469'

const sel = (names) => ({ select: { options: names.map((name) => ({ name })) } })
const plan = [
  [EVENTS, '活動管理', {
    '線上報名': { checkbox: {} },
    '收費':     { checkbox: {} },
    '報名費':   { number: { format: 'number' } },
    '付款說明': { rich_text: {} },
    '廣告圖':   { url: {} },
    '名額':     { number: { format: 'number' } },
  }],
  [REGS, '活動報名', {
    '職稱':     { rich_text: {} },
    '單位類型': sel(['牙醫診所', '牙體技術所', '醫院', '學校', '其他']),
    '付款狀態': sel(['免費', '未付款', '已付款', '已退款']),
    '應繳金額': { number: { format: 'number' } },
  }],
]

for (const [id, label, want] of plan) {
  const db = await notion.databases.retrieve({ database_id: id })
  let count = 0, cursor
  do {
    const r = await notion.databases.query({ database_id: id, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    count += r.results.length
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  console.log(`\n${label} DB：現有 ${count} 筆、${Object.keys(db.properties).length} 個欄位`)
  const props = {}
  for (const [k, v] of Object.entries(want)) {
    if (db.properties[k]) console.log(`  = ${k} 已存在（${db.properties[k].type}），略過`)
    else { props[k] = v; console.log(`  + ${k}（${Object.keys(v)[0]}）`) }
  }
  if (!Object.keys(props).length) { console.log('  無需變更'); continue }
  if (!apply) continue
  await notion.databases.update({ database_id: id, properties: props })
  const after = await notion.databases.retrieve({ database_id: id })
  console.log('  已寫入。read-back：', Object.keys(want).map((k) => `${k}=${after.properties[k]?.type ?? '缺'}`).join('，'),
    `；欄位數 ${Object.keys(db.properties).length} → ${Object.keys(after.properties).length}`)
}
if (!apply) console.log('\n[dry-run] 未寫入。確認後加 --apply')
