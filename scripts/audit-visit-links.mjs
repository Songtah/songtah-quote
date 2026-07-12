/**
 * 唯讀盤點:拜訪紀錄 → 客戶 relation 連結率(拜訪建議功能的資料前提)
 * 用法: node --env-file=.env.local scripts/audit-visit-links.mjs
 */
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const VISITS_DB = (process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16').replace(/-/g, '')

let total = 0, linked = 0, needFollowOpen = 0, needFollowOpenLinked = 0
const bySalesperson = {}
let cursor
do {
  const res = await notion.databases.query({
    database_id: VISITS_DB, page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  })
  for (const page of res.results) {
    total++
    const rel = page.properties?.['🏥 牙科單位資料']?.relation ?? []
    const sp = page.properties?.['業務人員']?.select?.name ?? '(空)'
    bySalesperson[sp] = bySalesperson[sp] || { total: 0, linked: 0 }
    bySalesperson[sp].total++
    const isLinked = rel.length > 0
    if (isLinked) { linked++; bySalesperson[sp].linked++ }
    const nf = page.properties?.['是否需追蹤']?.checkbox
    const done = page.properties?.['追蹤已結案']?.checkbox
    if (nf && !done) { needFollowOpen++; if (isLinked) needFollowOpenLinked++ }
  }
  cursor = res.has_more ? res.next_cursor : undefined
} while (cursor)

console.log(`拜訪總筆數: ${total}${total === 10000 ? ' ⚠️ 剛好 10000,疑似截斷,需分區重掃' : ''}`)
console.log(`有客戶連結: ${linked} (${(linked / total * 100).toFixed(1)}%)`)
console.log(`未結案待追蹤: ${needFollowOpen},其中有連結: ${needFollowOpenLinked} (${needFollowOpen ? (needFollowOpenLinked / needFollowOpen * 100).toFixed(1) : 0}%)`)
console.log('\n各業務連結率:')
Object.entries(bySalesperson).sort((a, b) => b[1].total - a[1].total).forEach(([sp, s]) => {
  console.log(`  ${sp.padEnd(8)} ${s.linked}/${s.total} (${(s.linked / s.total * 100).toFixed(0)}%)`)
})
