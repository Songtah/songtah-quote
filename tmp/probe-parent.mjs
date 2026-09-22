import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
for (const [label, id] of [['客戶主檔', process.env.NOTION_CUSTOMERS_SYSTEM_DB], ['客情', process.env.NOTION_VISITS_DB], ['監控', process.env.NOTION_CLINIC_MONITOR_DB]]) {
  if (!id) continue
  try {
    const db = await notion.databases.retrieve({ database_id: id })
    console.log(label, '→ parent:', JSON.stringify(db.parent), '｜title:', (db.title||[]).map(t=>t.plain_text).join(''))
  } catch (e) { console.log(label, 'ERR', e.message) }
}
