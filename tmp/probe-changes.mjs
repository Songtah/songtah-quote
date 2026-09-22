import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CLINIC_MONITOR_DB
const t = (P,f) => (P[f]?.rich_text ?? []).map(x=>x.plain_text).join('')
let cur, rows=[]
do {
  const r = await notion.databases.query({ database_id: db, page_size: 100, start_cursor: cur,
    filter: { property: '月份', date: { equals: '2026-09-01' } } })
  for (const p of r.results) rows.push({
    type: p.properties['異動類型']?.select?.name, code: t(p.properties,'機構代碼'),
    name: t(p.properties,'健保名稱'), cust: t(p.properties,'客戶名稱'), addr: t(p.properties,'地址'),
  })
  cur = r.has_more ? r.next_cursor : undefined
} while (cur)
console.log('2026-09 監控紀錄', rows.length)
const g = {}
for (const r of rows) g[r.type]=(g[r.type]??0)+1
console.log(g)
console.log('含「致臻」：', rows.filter(r=>r.name.includes('致臻')||r.cust.includes('致臻')))
console.log('新開業樣本：', rows.filter(r=>r.type==='新開業').slice(0,8))
console.log('新增停業樣本：', rows.filter(r=>r.type==='新增停業').slice(0,8))
