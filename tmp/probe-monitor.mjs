import { Client } from '@notionhq/client'
import fs from 'fs'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CLINIC_MONITOR_DB
if (!db) { console.log('NOTION_CLINIC_MONITOR_DB 未設定'); process.exit(0) }
const cache = JSON.parse(fs.readFileSync('data/bas-cache.json','utf8'))
const kindByCode = new Map(Object.values(cache).map(v => [v.code, v.kind]))
let cur, rows = []
do {
  const r = await notion.databases.query({ database_id: db, page_size: 100, start_cursor: cur,
    sorts:[{property:'月份',direction:'descending'}] })
  for (const p of r.results) {
    const P = p.properties
    const t = (f) => (P[f]?.rich_text ?? []).map(x=>x.plain_text).join('')
    rows.push({
      month: (P['月份']?.date?.start ?? '').slice(0,7),
      type: P['異動類型']?.select?.name ?? '',
      code: t('機構代碼'), name: t('健保名稱'),
    })
  }
  cur = r.has_more ? r.next_cursor : undefined
} while (cur)
console.log('紀錄總數', rows.length)
const months = [...new Set(rows.map(r=>r.month))].sort()
console.log('月份', months)
const byType = {}
for (const r of rows) byType[r.type] = (byType[r.type]??0)+1
console.log('異動類型', byType)
// kind 推斷率
const kindOf = (r) => kindByCode.get(r.code) || (/^2Y/.test(r.code) ? '牙體技術所' : (r.name||'').includes('醫院') ? '醫院' : r.code ? '牙醫診所' : '')
const k = {}
for (const r of rows) { const kk=kindOf(r)||'無法判斷'; k[kk]=(k[kk]??0)+1 }
console.log('類別推斷', k)
console.log('月×類型×類別樣本：')
const g = {}
for (const r of rows) { const key=`${r.month}|${kindOf(r)||'?'}|${r.type}`; g[key]=(g[key]??0)+1 }
Object.entries(g).sort().forEach(([k,v])=>console.log('  ',k,v))
