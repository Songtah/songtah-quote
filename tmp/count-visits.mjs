import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = (process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16').replace(/-/g,'')
let cur, n=0, newest=[]
do {
  const r = await notion.databases.query({ database_id: db, page_size: 100, start_cursor: cur,
    sorts:[{property:'日期',direction:'descending'}] })
  if (!cur) newest = r.results.slice(0,5).map(p=>({
    d: p.properties['日期']?.date?.start,
    n: (p.properties['單位名稱']?.title??[]).map(t=>t.plain_text).join(''),
    sp: p.properties['業務人員']?.select?.name }))
  n += r.results.length
  cur = r.has_more ? r.next_cursor : undefined
} while (cur)
console.log('客情紀錄總筆數', n)
console.log('最新 5 筆', JSON.stringify(newest, null, 1))
