import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB
const name = process.argv[2] ?? '盛光牙體技術所'
const q = await notion.databases.query({ database_id: db, filter: { property: '客戶名稱', title: { equals: name } } })
for (const p of q.results) {
  const P = p.properties
  const txt = (x) => (x?.rich_text ?? []).map(t => t.plain_text).join('')
  const filled = Object.entries(P).filter(([, v]) => {
    const t = v.type
    const val = v[t]
    return Array.isArray(val) ? val.length : (val !== null && val !== undefined && val !== '' && val !== false)
  }).map(([k]) => k)
  console.log('—'.repeat(40))
  console.log('id', p.id, '建立', p.created_time.slice(0,10), '最後編輯', p.last_edited_time.slice(0,10))
  console.log('地址', txt(P['地址']), '｜電話', P['電話']?.phone_number ?? '', '｜代碼', txt(P['機構代碼']),
    '｜縣市', P['縣市']?.select?.name, P['行政區']?.select?.name ?? txt(P['行政區']),
    '｜負責業務', P['負責業務']?.select?.name, '｜狀態', P['機構狀態']?.select?.name)
  console.log('負責人', txt(P['負責人']), '｜開發狀態', (P['開發狀態']?.multi_select ?? []).map(x=>x.name).join('、'), '｜類型', P['客戶類型']?.select?.name)
  console.log('拜訪關聯', (P['Related to 拜訪紀錄 (診所)']?.relation ?? []).length, '筆')
  console.log('已填欄位', filled.length, ':', filled.join('、'))
}
