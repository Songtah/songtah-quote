/**
 * 一次性腳本：活動報名 DB 加上「客戶足跡」所需欄位（只增不改、不刪）。
 * 用法：node scripts/setup-registration-footprint-fields.mjs          （dry-run，只印出差異）
 *       node scripts/setup-registration-footprint-fields.mjs --apply  （實際寫入 schema）
 *
 * 新增：
 *   來源      select   報名表單／展會簽到／人工登記 —— 足跡從哪裡來
 *   表單活動  text     外掛表單無法填 relation 時，填活動名稱，由系統自動關聯「活動」
 *   縣市      text     客戶比對用（同名機構跨縣市時縮小範圍）
 *   配對說明  text     系統自動配對的依據或未配對原因，供人工複核
 *   狀態      加選項   已到場（展會簽到＝本人到場，訊號強於「已報名」）
 * 狀態選項更新時會把既有選項原樣帶上，避免 databases.update 覆蓋掉既有選項。
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
const DB_ID = env.NOTION_REGISTRATIONS_DB
if (!DB_ID) { console.error('缺少 NOTION_REGISTRATIONS_DB'); process.exit(1) }

const db = await notion.databases.retrieve({ database_id: DB_ID })
const rows = await notion.databases.query({ database_id: DB_ID, page_size: 5 })
console.log(`活動報名 DB：現有 ${rows.results.length}${rows.has_more ? '+' : ''} 筆資料（schema 只增不改，不影響資料）`)

const props = {}
const want = {
  '來源':     { select: { options: [{ name: '報名表單', color: 'blue' }, { name: '展會簽到', color: 'orange' }, { name: '人工登記', color: 'gray' }] } },
  '表單活動': { rich_text: {} },
  '縣市':     { rich_text: {} },
  '配對說明': { rich_text: {} },
}
for (const [k, v] of Object.entries(want)) {
  if (db.properties[k]) console.log(`  = ${k} 已存在（${db.properties[k].type}），略過`)
  else { props[k] = v; console.log(`  + ${k}（${Object.keys(v)[0]}）`) }
}
const status = db.properties['狀態']
if (status?.type === 'select' && !status.select.options.some((o) => o.name === '已到場')) {
  props['狀態'] = { select: { options: [...status.select.options.map(({ name, color }) => ({ name, color })), { name: '已到場', color: 'green' }] } }
  console.log(`  ~ 狀態 加選項「已到場」（保留既有：${status.select.options.map((o) => o.name).join('/')}）`)
}

if (!Object.keys(props).length) { console.log('無需變更'); process.exit(0) }
if (!apply) { console.log('\n[dry-run] 未寫入。確認後加 --apply'); process.exit(0) }
await notion.databases.update({ database_id: DB_ID, properties: props })
const after = await notion.databases.retrieve({ database_id: DB_ID })
console.log('\n已寫入。read-back：', Object.keys(want).map((k) => `${k}=${after.properties[k]?.type ?? '缺'}`).join('，'),
  '；狀態選項：', after.properties['狀態'].select.options.map((o) => o.name).join('/'))
