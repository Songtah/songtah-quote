// 全客戶主檔完整欄位傾印（依縣市分區，避開 10k 靜默截斷）
import { Client } from '@notionhq/client'
import fs from 'fs'
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB

const meta = await notion.databases.retrieve({ database_id: db })
const cities = (meta.properties?.['縣市']?.select?.options ?? []).map((o) => o.name).filter(Boolean)
const partitions = [...cities.map((c) => ({ property: '縣市', select: { equals: c } })),
                    { property: '縣市', select: { is_empty: true } }]

const txt = (x) => (x?.rich_text ?? []).map((t) => t.plain_text).join('').trim()
const out = []
for (const filter of partitions) {
  let cursor
  do {
    const res = await notion.databases.query({ database_id: db, page_size: 100, filter, start_cursor: cursor })
    for (const p of res.results) {
      const P = p.properties
      out.push({
        id: p.id.replace(/-/g, ''),
        name: (P['客戶名稱']?.title ?? []).map((t) => t.plain_text).join('').trim(),
        type: P['客戶類型']?.select?.name ?? '',
        city: P['縣市']?.select?.name ?? '',
        dist: P['行政區']?.select?.name ?? txt(P['行政區']),
        addr: txt(P['地址']),
        tel: P['電話']?.phone_number ?? '',
        owner: txt(P['負責人']),
        code: txt(P['機構代碼']),
        status: P['機構狀態']?.select?.name ?? '',
        sp: P['負責業務']?.select?.name ?? '',
        stage: P['開發階段']?.select?.name ?? '',
        source: P['開發來源']?.select?.name ?? '',
        devStatus: (P['開發狀態']?.multi_select ?? []).map((x) => x.name).join('、'),
        visits: (P['Related to 拜訪紀錄 (診所)']?.relation ?? []).length,
        created: (p.created_time ?? '').slice(0, 10),
        edited: (p.last_edited_time ?? '').slice(0, 10),
        filled: Object.entries(P).filter(([, v]) => {
          const val = v[v.type]
          return Array.isArray(val) ? val.length > 0 : (val !== null && val !== undefined && val !== '' && val !== false)
        }).length,
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  process.stdout.write('.')
}
fs.writeFileSync(SP + '/cust-full.json', JSON.stringify(out))
console.log('\n總筆數', out.length)
