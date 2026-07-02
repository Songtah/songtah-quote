/**
 * scripts/dev-stage-migrate.mjs — 開發階段欄位建置與「潛在客戶」遷移
 *
 * 用法：
 *   node --env-file=.env.local scripts/dev-stage-migrate.mjs           # 唯讀盤點(dry-run)
 *   node --env-file=.env.local scripts/dev-stage-migrate.mjs --add-field   # 建立 開發階段/開發來源 欄位(additive,安全)
 *   node --env-file=.env.local scripts/dev-stage-migrate.mjs --migrate     # 潛在客戶→開發階段=線索,並改寫機構狀態(需先經用戶確認)
 */
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const dbId = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? process.env.NOTION_CUSTOMERS_DB ?? '').replace(/-/g, '')

const DEV_STAGES = ['線索', '已接觸', '試用中', '報價中', '已成交', '流失']
const DEV_SOURCES = ['BAS新開業', '潛在客戶遷移', '手動新增', '休眠喚醒']

const MODE = process.argv.includes('--migrate') ? 'migrate'
  : process.argv.includes('--add-field') ? 'add-field'
  : 'audit'

async function loadAll() {
  const pages = []
  let cursor
  do {
    const res = await notion.databases.query({
      database_id: dbId, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    pages.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return pages
}

async function main() {
  if (!dbId) throw new Error('NOTION_CUSTOMERS_SYSTEM_DB 未設定')
  const db = await notion.databases.retrieve({ database_id: dbId })
  const props = db.properties
  const hasStage = !!props['開發階段']
  const hasSource = !!props['開發來源']
  console.log(`模式: ${MODE}`)
  console.log(`開發階段欄位: ${hasStage ? '已存在' : '不存在'} / 開發來源欄位: ${hasSource ? '已存在' : '不存在'}`)

  if (MODE === 'add-field') {
    const update = {}
    if (!hasStage) update['開發階段'] = { select: { options: DEV_STAGES.map((name) => ({ name })) } }
    if (!hasSource) update['開發來源'] = { select: { options: DEV_SOURCES.map((name) => ({ name })) } }
    if (Object.keys(update).length === 0) { console.log('欄位皆已存在,無事可做'); return }
    await notion.databases.update({ database_id: dbId, properties: update })
    console.log('✅ 已建立欄位:', Object.keys(update).join(', '))
    return
  }

  // audit / migrate 都需要掃全庫
  const pages = await loadAll()
  const counts = {}
  const potentials = []
  for (const page of pages) {
    const s = page.properties?.['機構狀態']?.select?.name ?? '(空)'
    counts[s] = (counts[s] ?? 0) + 1
    if (s === '潛在客戶') {
      potentials.push({
        id: page.id,
        name: page.properties?.['客戶名稱']?.title?.[0]?.plain_text ?? '(無名稱)',
        devStage: page.properties?.['開發階段']?.select?.name ?? null,
      })
    }
  }
  console.log(`客戶總數: ${pages.length}`)
  console.log('機構狀態分佈:', JSON.stringify(counts, null, 2))
  console.log(`潛在客戶筆數: ${potentials.length}`)
  if (MODE === 'audit') {
    console.log('潛在客戶清單:', JSON.stringify(potentials, null, 2))
    return
  }

  // migrate:潛在客戶 → 開發階段=線索、開發來源=潛在客戶遷移、機構狀態=開業
  if (!hasStage) throw new Error('請先跑 --add-field 建立欄位')
  let ok = 0
  for (const p of potentials) {
    await notion.pages.update({
      page_id: p.id,
      properties: {
        '開發階段': { select: { name: p.devStage ?? '線索' } }, // 已有階段者不覆蓋
        '開發來源': { select: { name: '潛在客戶遷移' } },
        '機構狀態': { select: { name: '開業' } },
      },
    })
    ok++
    console.log(`  ✓ ${p.name}`)
  }
  console.log(`✅ 遷移完成 ${ok}/${potentials.length} 筆`)
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
