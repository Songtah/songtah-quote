import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_TENDERS_DB ?? '3e3dcdaafb2a81288561f750924ea729'
await notion.databases.update({ database_id: db, properties: {
  '資料來源': { select: { options: [
    { name: '官方開放資料', color: 'green' },
    { name: '即時API', color: 'yellow' },
  ] } },
} })
console.log('ok')
