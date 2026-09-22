import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const parent = '340dcdaa-fb2a-818a-bc44-c434c04964c3'   // 與客戶主檔同一個父頁面
const customersDb = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? '').replace(/-/g,'')

const db = await notion.databases.create({
  parent: { type: 'page_id', page_id: parent },
  title: [{ text: { content: '政府標案' } }],
  description: [{ text: { content: '政府電子採購網的牙科相關標案；每日自動抓取與回填，追蹤狀態由業務維護。' } }],
  properties: {
    '標案名稱':   { title: {} },
    '標案ID':     { rich_text: {} },
    '案號':       { rich_text: {} },
    '機關名稱':   { rich_text: {} },
    '機關代碼':   { rich_text: {} },
    '縣市':       { select: {} },
    '行政區':     { rich_text: {} },
    '標的分類':   { rich_text: {} },
    '公告類型':   { select: {} },
    '公告日':     { date: {} },
    '截止投標':   { date: {} },
    '預算金額':   { number: { format: 'number_with_commas' } },
    '決標金額':   { number: { format: 'number_with_commas' } },
    '底價':       { number: { format: 'number_with_commas' } },
    '得標廠商':   { rich_text: {} },
    '投標廠商':   { rich_text: {} },
    '崧達有投標': { checkbox: {} },
    '命中關鍵字': { rich_text: {} },
    '狀態':       { select: { options: [
      { name: '待評估', color: 'default' }, { name: '投標中', color: 'yellow' },
      { name: '已投標', color: 'blue' }, { name: '得標', color: 'green' },
      { name: '未得標', color: 'gray' }, { name: '放棄', color: 'brown' },
    ] } },
    '負責業務':   { select: {} },
    '備註':       { rich_text: {} },
    '公告連結':   { url: {} },
    '聯絡人':     { rich_text: {} },
    '聯絡電話':   { rich_text: {} },
    ...(customersDb ? { '關聯客戶': { relation: { database_id: customersDb, single_property: {} } } } : {}),
  },
})
console.log('DB_ID=' + db.id.replace(/-/g,''))
console.log('URL=' + db.url)
