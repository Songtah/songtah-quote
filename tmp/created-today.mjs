import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_VISITS_DB
const since = process.argv[2] ?? '2026-09-16T00:00:00+08:00'
let cursor, rows = []
do {
  const r = await notion.databases.query({
    database_id: db,
    filter: { timestamp: 'created_time', created_time: { on_or_after: since } },
    page_size: 100,
    start_cursor: cursor,
  })
  rows.push(...r.results)
  cursor = r.has_more ? r.next_cursor : undefined
} while (cursor)
const by = {}
for (const p of rows) {
  const d = p.properties['日期']?.date?.start ?? '無日期'
  const sp = p.properties['業務人員']?.select?.name ?? '?'
  const k = d.slice(0, 7)
  ;(by[k] ??= {})[sp] = ((by[k] ?? {})[sp] ?? 0) + 1
}
console.log('今日建立筆數', rows.length)
console.log(JSON.stringify(by, null, 1))
