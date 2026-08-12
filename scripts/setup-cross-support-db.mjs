/**
 * 一次性腳本:在 Notion 建立「跨區支援報備」資料庫。
 * 父頁面:企業管理系統資料庫(340dcdaa-fb2a-8184-b6ec-d4777ad00b8d),與訂貨單/促銷活動等 DB 同層。
 * 用法: node scripts/setup-cross-support-db.mjs
 */
import { Client } from '@notionhq/client'
import fs from 'fs'
import path from 'path'

const envPath = path.join(process.cwd(), '.env.local')
const envText = fs.readFileSync(envPath, 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const notion = new Client({ auth: env.NOTION_TOKEN })
const PARENT_PAGE_ID = '340dcdaa-fb2a-8184-b6ec-d4777ad00b8d' // 企業管理系統資料庫
const CUSTOMERS_DB = env.NOTION_CUSTOMERS_SYSTEM_DB || env.NOTION_CUSTOMERS_DB

if (!CUSTOMERS_DB) {
  console.error('缺少 NOTION_CUSTOMERS_SYSTEM_DB / NOTION_CUSTOMERS_DB 環境變數,無法建立客戶 relation')
  process.exit(1)
}

const db = await notion.databases.create({
  parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
  title: [{ type: 'text', text: { content: '跨區支援報備' } }],
  properties: {
    '標題':       { title: {} },
    '報備業務':   { select: {} },
    '客戶':       { relation: { database_id: CUSTOMERS_DB, single_property: {} } },
    '支援日期':   { date: {} },
    '支援事由':   { rich_text: {} },
    '原負責業務': { rich_text: {} },
    '狀態':       { select: { options: [{ name: '已比對', color: 'green' }, { name: '待確認', color: 'yellow' }] } },
    '原始訊息':   { rich_text: {} },
  },
})

console.log('已建立「跨區支援報備」資料庫')
console.log('id:', db.id)
console.log('url:', db.url)
