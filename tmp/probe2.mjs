import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CLINIC_MONITOR_DB
const r = await notion.databases.query({ database_id: db, page_size: 6,
  filter: { property: '異動類型', select: { equals: '查無代碼' } } })
for (const p of r.results) {
  const P=p.properties, t=(f)=>(P[f]?.rich_text??[]).map(x=>x.plain_text).join('')
  console.log('created', p.created_time.slice(0,10), '｜月份', P['月份']?.date?.start ?? '(空)', '｜', t('健保名稱')||t('客戶名稱'), t('機構代碼'))
}
// 各月份分區筆數（避免 10k 截斷）
for (const m of ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']) {
  let cur, n=0
  do {
    const q = await notion.databases.query({ database_id: db, page_size: 100, start_cursor: cur,
      filter: { property:'月份', date:{ equals: `${m}-01` } } })
    n += q.results.length; cur = q.has_more ? q.next_cursor : undefined
  } while (cur)
  console.log(m, n, '筆')
}
