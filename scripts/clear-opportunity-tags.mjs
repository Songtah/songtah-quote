import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const customersDb = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB
if (!customersDb) throw new Error('缺少客戶主檔設定')

const rows = []
let cursor
do {
  const response = await notion.databases.query({
    database_id: customersDb.replace('collection://', ''),
    page_size: 100,
    filter: { property: '商機標籤', multi_select: { is_not_empty: true } },
    ...(cursor ? { start_cursor: cursor } : {}),
  })
  rows.push(...response.results)
  cursor = response.has_more ? response.next_cursor : undefined
} while (cursor)

const mapped = rows.map((page) => ({
  id: page.id,
  name: page.properties?.['客戶名稱']?.title?.map((item) => item.plain_text).join('') || '',
  tags: page.properties?.['商機標籤']?.multi_select?.map((item) => item.name) || [],
  owner: page.properties?.['負責業務']?.select?.name || '',
  stage: page.properties?.['開發階段']?.select?.name || '',
}))

console.log(JSON.stringify({
  mode: process.argv.includes('--execute') ? 'execute' : 'dry-run',
  affected: mapped.length,
  sample: mapped.slice(0, 20),
}, null, 2))

if (process.argv.includes('--execute')) {
  for (const [index, row] of mapped.entries()) {
    await notion.pages.update({
      page_id: row.id,
      properties: { '商機標籤': { multi_select: [] } },
    })
    console.log(`cleared ${index + 1}/${mapped.length}: ${row.id}`)
  }
}
