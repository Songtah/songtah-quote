import { Client } from '@notionhq/client'

const TITLE = '業務轄區設定'
const token = process.env.NOTION_TOKEN
const customersDb = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB

if (!token || !customersDb) {
  throw new Error('缺少 NOTION_TOKEN 或客戶主檔資料庫設定')
}

const notion = new Client({ auth: token })

const search = await notion.search({
  query: TITLE,
  filter: { property: 'object', value: 'database' },
  page_size: 100,
})
const existing = search.results.find((result) =>
  result.object === 'database' &&
  result.title?.map((item) => item.plain_text).join('') === TITLE
)

if (existing) {
  await notion.databases.update({
    database_id: existing.id,
    properties: { '負責業務ID': { rich_text: {} } },
  })
  console.log(`NOTION_TERRITORIES_DB=${existing.id}`)
  process.exit(0)
}

const source = await notion.databases.retrieve({ database_id: customersDb })
if (source.parent?.type !== 'page_id') {
  throw new Error('客戶主檔沒有可供建立轄區資料庫的 page_id 父層')
}

const created = await notion.databases.create({
  parent: { type: 'page_id', page_id: source.parent.page_id },
  title: [{ type: 'text', text: { content: TITLE } }],
  properties: {
    '轄區名稱': { title: {} },
    '縣市': { select: {} },
    '行政區': { rich_text: {} },
    '負責業務': { select: {} },
    '負責業務ID': { rich_text: {} },
    '狀態': {
      select: {
        options: [
          { name: '規劃中', color: 'gray' },
          { name: '開發中', color: 'green' },
          { name: '暫停', color: 'yellow' },
          { name: '結束', color: 'red' },
        ],
      },
    },
    '生效日': { date: {} },
    '備註': { rich_text: {} },
    '建立者': { rich_text: {} },
  },
})

console.log(`NOTION_TERRITORIES_DB=${created.id}`)
