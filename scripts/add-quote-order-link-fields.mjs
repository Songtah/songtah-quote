/**
 * 報價單轉訂貨單（2026-10-28）：報價品項存貨號、報價單記轉出的訂單、訂單記來源報價。只新增欄位。
 *   node scripts/add-quote-order-link-fields.mjs          # dry-run
 *   node scripts/add-quote-order-link-fields.mjs --write
 */
import fs from 'node:fs'
import { Client } from '@notionhq/client'

for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const write = process.argv.includes('--write')
const text = { rich_text: {} }
const PLAN = [
  { db: process.env.NOTION_ITEMS_DB, props: { 貨號: text } },
  { db: process.env.NOTION_QUOTES_DB, props: { 轉出訂單: text } },   // 「訂單 id|訂單編號」
  { db: process.env.NOTION_ORDERS_DB, props: { 來源報價: text } },   // 「報價 id|報價單號」
]
for (const { db, props } of PLAN) {
  const d = await notion.databases.retrieve({ database_id: db })
  const missing = Object.fromEntries(Object.entries(props).filter(([k]) => !d.properties[k]))
  console.log(`== ${d.title?.[0]?.plain_text ?? db}：新增 ${Object.keys(missing).join('、') || '（無）'}`)
  if (write && Object.keys(missing).length) { await notion.databases.update({ database_id: db, properties: missing }); console.log('   已新增') }
}
if (!write) console.log('\n（dry-run，加 --write 實際新增）')
