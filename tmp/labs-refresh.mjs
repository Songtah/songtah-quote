// 重新抓雙北技工所（公司/Paul/Edward 名下）最新資料，輸出給試算表用
import { Client } from '@notionhq/client'
import fs from 'fs'
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB
const txt = (p) => (p?.rich_text ?? []).map((t) => t.plain_text).join('').trim()

const out = []
for (const city of ['臺北市', '新北市']) {
  let cursor
  do {
    const res = await notion.databases.query({
      database_id: db, page_size: 100, start_cursor: cursor,
      filter: { and: [
        { property: '縣市', select: { equals: city } },
        { property: '客戶類型', select: { equals: '牙體技術所' } },
      ] },
    })
    for (const p of res.results) {
      if (p.archived) continue
      const P = p.properties
      const sp = P['負責業務']?.select?.name ?? ''
      if (!['公司', 'Paul', 'Edward'].includes(sp)) continue
      out.push({
        id: p.id.replace(/-/g, ''),
        名稱: (P['客戶名稱']?.title ?? []).map((t) => t.plain_text).join('').trim(),
        縣市: city,
        行政區: P['行政區']?.select?.name ?? txt(P['行政區']),
        地址: txt(P['地址']),
        電話: P['電話']?.phone_number ?? '',
        負責人: txt(P['負責人']),
        機構代碼: txt(P['機構代碼']),
        機構狀態: P['機構狀態']?.select?.name ?? '',
        健保特約: P['健保特約']?.checkbox ? '是' : '',
        牙體技術師數: P['牙體技術師數']?.number ?? '',
        牙體技術生數: P['牙體技術生數']?.number ?? '',
        附屬技工室: P['附屬技工室']?.checkbox ? '是' : '',
        客戶等級: P['客戶等級']?.select?.name ?? '',
        開發階段: P['開發階段']?.select?.name ?? '',
        開發來源: P['開發來源']?.select?.name ?? '',
        開發狀態: (P['開發狀態']?.multi_select ?? []).map((x) => x.name).join('、'),
        商機標籤: (P['商機標籤']?.multi_select ?? []).map((x) => x.name).join('、'),
        相關公司行號: txt(P['相關公司行號']),
        負責業務: sp,
        機構資料連結: P['機構資料']?.url ?? '',
        建立日期: (p.created_time ?? '').slice(0, 10),
        拜訪關聯: (P['Related to 拜訪紀錄 (診所)']?.relation ?? []).length,
      })
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
}
fs.writeFileSync(SP + '/labs-refresh.json', JSON.stringify(out, null, 1))
console.log('雙北技工所（公司/Paul/Edward）', out.length, '家｜其中有拜訪關聯',
  out.filter((o) => o.拜訪關聯).length)
