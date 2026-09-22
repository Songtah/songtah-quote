import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CLINIC_MONITOR_DB
let cur, codes = [], days = {}
do {
  const r = await notion.databases.query({ database_id: db, page_size: 100, start_cursor: cur,
    filter: { and: [ { property:'異動類型', select:{equals:'查無代碼'} }, { property:'月份', date:{is_empty:true} } ] } })
  for (const p of r.results) {
    const c = (p.properties['機構代碼']?.rich_text??[]).map(x=>x.plain_text).join('')
    codes.push(c); const d = p.created_time.slice(0,10); days[d]=(days[d]??0)+1
  }
  cur = r.has_more ? r.next_cursor : undefined
} while (cur)
console.log('查無代碼(無月份) 總筆數', codes.length, '｜不重複代碼', new Set(codes).size)
console.log('建立日期分布', days)
