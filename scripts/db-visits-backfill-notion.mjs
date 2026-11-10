// 退回用：把系統在資料庫產生的客情（origin='db'）回填到 Notion 客情庫。
// 只在要把客情來源退回 Notion（VISITS_SOURCE=notion）時使用。預設 dry-run，加 --execute 才寫。
//   npx tsx scripts/db-visits-backfill-notion.mjs            # 列出筆數與樣本
//   npx tsx scripts/db-visits-backfill-notion.mjs --execute  # 建 Notion 頁面並把資料庫列的 id 改成 Notion 頁面 id
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const postgres = require('postgres')
const { DB } = await import('../lib/notion/shared.ts')
const EXECUTE = process.argv.includes('--execute')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 2 })
const rt = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : [])
const rows = await sql`select * from visits where origin = 'db' order by visit_date`
console.log(`資料庫產生的客情 ${rows.length} 筆${EXECUTE ? '' : '（dry-run）'}`)
for (const r of rows.slice(0, 5)) console.log(`  ${r.visit_date?.toISOString?.().slice(0, 10) ?? r.visit_date} ${r.salesperson ?? ''} ${r.unit_name}`)
if (!EXECUTE) { await sql.end(); process.exit(0) }
let done = 0
for (const r of rows) {
  const props = {
    '單位名稱': { title: rt(r.unit_name) },
    ...(r.visit_date ? { '日期': { date: { start: r.visit_date.toISOString().slice(0, 10) } } } : {}),
    ...(r.salesperson ? { '業務人員': { select: { name: r.salesperson } } } : {}),
    '拜訪內容': { rich_text: rt(r.content) }, '地址': { rich_text: rt(r.address) },
    ...(r.customer_notion_id ? { '🏥 牙科單位資料': { relation: [{ id: r.customer_notion_id }] } } : {}),
    ...(r.customer_tags?.length ? { '客戶標籤': { multi_select: r.customer_tags.map((name) => ({ name })) } } : {}),
    ...(r.competitors?.length ? { '競品': { multi_select: r.competitors.map((name) => ({ name })) } } : {}),
    ...(r.interested_product_ids?.length ? { '有興趣的產品': { relation: r.interested_product_ids.map((id) => ({ id })) } } : {}),
    ...(r.interaction_type ? { '互動類型': { select: { name: r.interaction_type } } } : {}),
    ...(r.purpose ? { '互動目的': { select: { name: r.purpose } } } : {}),
    ...(r.reaction ? { '客戶反應': { select: { name: r.reaction } } } : {}),
    ...(r.next_action ? { '後續動作': { rich_text: rt(r.next_action) } } : {}),
    ...(r.contact_name ? { '聯絡人': { rich_text: rt(r.contact_name) } } : {}),
    ...(r.status ? { '狀態': { status: { name: r.status } } } : {}),
    '是否需追蹤': { checkbox: !!r.needs_follow_up }, '追蹤已結案': { checkbox: !!r.follow_up_closed },
    ...(r.next_follow_up ? { '下次追蹤日': { date: { start: r.next_follow_up.toISOString().slice(0, 10) } } } : {}),
  }
  const page = await notion.pages.create({ parent: { database_id: DB.visits }, properties: props })
  await sql`update visits set notion_page_id = ${page.id}, origin = 'notion' where notion_page_id = ${r.notion_page_id}`
  done++
}
console.log(`已回填 ${done} 筆；資料庫列 id 已改為 Notion 頁面 id`)
await sql.end()
