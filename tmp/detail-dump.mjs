// 撈雙北（技工所＋診所）無客情紀錄客戶的完整欄位，輸出 JSON 供試算表使用
import { Client } from '@notionhq/client'
import fs from 'fs'
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB

const want = new Set(
  JSON.parse(fs.readFileSync(SP + '/nocontact.json', 'utf8'))
    .filter((r) => ['臺北市', '新北市'].includes(r['縣市']) && ['牙體技術所', '牙醫診所'].includes(r['類型']))
    .map((r) => r['客戶']))
const byId = new Map(JSON.parse(fs.readFileSync(SP + '/cust-dump.json', 'utf8')).map((c) => [c.name, c.id]))

const txt = (p) => (p?.rich_text ?? []).map((t) => t.plain_text).join('').trim()
const out = []
let cursor
do {
  const r = await notion.databases.query({
    database_id: db, page_size: 100, start_cursor: cursor,
    filter: { or: [
      { and: [{ property: '縣市', select: { equals: '臺北市' } }, { property: '負責業務', select: { is_not_empty: true } }] },
      { and: [{ property: '縣市', select: { equals: '新北市' } }, { property: '負責業務', select: { is_not_empty: true } }] },
    ] },
  })
  for (const p of r.results) {
    const name = (p.properties['客戶名稱']?.title ?? []).map((t) => t.plain_text).join('').trim()
    if (!want.has(name)) continue
    const P = p.properties
    out.push({
      名稱: name,
      類型: P['客戶類型']?.select?.name ?? '',
      縣市: P['縣市']?.select?.name ?? '',
      行政區: P['行政區']?.select?.name ?? txt(P['行政區']),
      地址: txt(P['地址']),
      電話: P['電話']?.phone_number ?? '',
      負責人: txt(P['負責人']),
      機構代碼: txt(P['機構代碼']),
      機構狀態: P['機構狀態']?.select?.name ?? '',
      健保特約: P['健保特約']?.checkbox ? '是' : '',
      附屬技工室: P['附屬技工室']?.checkbox ? '是' : '',
      牙醫師數: P['牙醫師數']?.number ?? '',
      牙體技術師數: P['牙體技術師數']?.number ?? '',
      牙體技術生數: P['牙體技術生數']?.number ?? '',
      客戶等級: P['客戶等級']?.select?.name ?? '',
      開發階段: P['開發階段']?.select?.name ?? '',
      開發來源: P['開發來源']?.select?.name ?? '',
      開發狀態: (P['開發狀態']?.multi_select ?? []).map((x) => x.name).join('、'),
      商機標籤: (P['商機標籤']?.multi_select ?? []).map((x) => x.name).join('、'),
      相關公司行號: txt(P['相關公司行號']),
      負責業務: P['負責業務']?.select?.name ?? '',
      機構資料連結: P['機構資料']?.url ?? '',
      醫事人員連結: P['醫事人員連結']?.url ?? '',
      建立日期: (p.created_time ?? '').slice(0, 10),
    })
  }
  cursor = r.has_more ? r.next_cursor : undefined
} while (cursor)
fs.writeFileSync(SP + '/detail-dump.json', JSON.stringify(out, null, 1))
console.log('取得', out.length, '/', want.size)
const miss = [...want].filter((n) => !out.some((o) => o.名稱 === n))
if (miss.length) console.log('未取得：', miss.slice(0, 10).join('、'), miss.length > 10 ? `…共 ${miss.length}` : '')
