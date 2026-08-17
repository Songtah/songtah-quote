/**
 * scripts/backfill-bas-personnel.mjs — 回填「BAS新開業」客戶缺漏的醫事人員數/連結欄位
 *
 * 背景：fetchBasFull() 在 2026-08-12 之前只組出醫事人員頁連結，從未實際抓取人數，
 * createSystemCustomer() 也沒有對應參數，導致所有 BAS 匯入的客戶「牙醫師數/
 * 牙體技術師數/牙體技術生數」一律空白；部分舊資料也可能連三個連結欄位都缺。
 * 實測發現「開發來源=BAS新開業」只涵蓋新流程之後的匯入，還有更早匯入、已有
 * 機構代碼與連結但沒有 開發來源 標記的舊客戶（例：築嶼牙醫診所）不會被抓到，
 * 因此改用「機構代碼不為空」當篩選條件，涵蓋全部有 BAS 對照的客戶。
 * 本腳本只找機構代碼可在 data/bas-cache.json 反查到 basSeq/zoneSeq 的客戶，
 * 抓 BAS 現況補上「目前是空的欄位」——已有值的欄位一律不動（保留人工修正過的資料）。
 *
 * 用法：
 *   node --env-file=.env.local scripts/backfill-bas-personnel.mjs           # 唯讀盤點(dry-run)
 *   node --env-file=.env.local scripts/backfill-bas-personnel.mjs --write   # 實際寫入
 */
import { Client } from '@notionhq/client'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fetchBasFull } from '../lib/mohw-bas.mjs'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const dbId = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? process.env.NOTION_CUSTOMERS_DB ?? '').replace(/-/g, '')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadBasSeqByCode() {
  const map = new Map()
  const p = path.join(process.cwd(), 'data', 'bas-cache.json')
  if (!existsSync(p)) return map
  const cache = JSON.parse(readFileSync(p, 'utf8'))
  for (const [key, v] of Object.entries(cache)) {
    if (!v?.code) continue
    const [basSeq, zoneSeq] = key.split('__')
    if (basSeq && zoneSeq) map.set(v.code, { basSeq, zoneSeq })
  }
  return map
}

async function loadBasCustomers() {
  const pages = []
  let cursor
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      // 機構代碼不為空 = 有 BAS 對照的客戶，不限「開發來源=BAS新開業」
      // （較早匯入的舊客戶沒有此標記，但一樣有機構代碼可反查）
      filter: {
        and: [
          { property: '機構代碼', rich_text: { is_not_empty: true } },
          { property: '牙醫師數', number: { is_empty: true } },
        ],
      },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    pages.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return pages
}

const rawNumber = (page, field) => page.properties?.[field]?.number ?? null
const rawUrl = (page, field) => page.properties?.[field]?.url ?? null
const rawText = (page, field) =>
  page.properties?.[field]?.rich_text?.map((t) => t.plain_text).join('') ?? ''
const rawTitle = (page) =>
  page.properties?.['客戶名稱']?.title?.map((t) => t.plain_text).join('') ?? '(無名稱)'

async function main() {
  if (!dbId) throw new Error('NOTION_CUSTOMERS_SYSTEM_DB 未設定')

  const seqByCode = loadBasSeqByCode()
  const pages = await loadBasCustomers()
  console.log(`有機構代碼且缺牙醫師數 共 ${pages.length} 筆`)

  const candidates = []
  for (const page of pages) {
    const code = rawText(page, '機構代碼')
    const missingFields = []
    if (rawNumber(page, '牙醫師數') === null) missingFields.push('牙醫師數')
    if (rawNumber(page, '牙體技術師數') === null) missingFields.push('牙體技術師數')
    if (rawNumber(page, '牙體技術生數') === null) missingFields.push('牙體技術生數')
    if (!rawUrl(page, '機構資料')) missingFields.push('機構資料')
    if (!rawUrl(page, '醫事人員連結')) missingFields.push('醫事人員連結')
    if (!rawUrl(page, '診療科別連結')) missingFields.push('診療科別連結')
    if (missingFields.length === 0) continue

    const seq = code ? seqByCode.get(code) : undefined
    candidates.push({ id: page.id, name: rawTitle(page), code, missingFields, seq })
  }

  const resolvable = candidates.filter((c) => c.seq)
  const unresolvable = candidates.filter((c) => !c.seq)

  console.log(`缺欄位: ${candidates.length} 筆`)
  console.log(`  可反查 basSeq（能修）: ${resolvable.length} 筆`)
  console.log(`  機構代碼查無 bas-cache（無法自動修）: ${unresolvable.length} 筆`)
  console.log('\n樣本（前 10 筆可修）：')
  for (const c of resolvable.slice(0, 10)) {
    console.log(`  - ${c.name}（${c.code}）缺: ${c.missingFields.join('、')}`)
  }
  if (unresolvable.length > 0) {
    console.log('\n樣本（前 5 筆無法自動修，機構代碼在 bas-cache.json 查無對照）：')
    for (const c of unresolvable.slice(0, 5)) {
      console.log(`  - ${c.name}（機構代碼: ${c.code || '(空)'}）`)
    }
  }

  if (!WRITE) {
    console.log('\n[dry-run] 未寫入任何資料。確認無誤後加 --write 執行。')
    return
  }

  console.log(`\n開始寫入 ${resolvable.length} 筆...`)
  let ok = 0, failed = 0
  for (const c of resolvable) {
    try {
      const full = await fetchBasFull(c.seq)
      await sleep(200)
      if (!full) { console.log(`  ⚠ ${c.name}：BAS 抓取失敗，略過`); failed++; continue }

      const properties = {}
      if (c.missingFields.includes('牙醫師數') && typeof full.dentistCount === 'number')
        properties['牙醫師數'] = { number: full.dentistCount }
      if (c.missingFields.includes('牙體技術師數') && typeof full.technicianCount === 'number')
        properties['牙體技術師數'] = { number: full.technicianCount }
      if (c.missingFields.includes('牙體技術生數') && typeof full.technicianTraineeCount === 'number')
        properties['牙體技術生數'] = { number: full.technicianTraineeCount }
      if (c.missingFields.includes('機構資料') && full.infoUrl)
        properties['機構資料'] = { url: full.infoUrl }
      if (c.missingFields.includes('醫事人員連結') && full.personnelUrl)
        properties['醫事人員連結'] = { url: full.personnelUrl }
      if (c.missingFields.includes('診療科別連結') && full.deptUrl)
        properties['診療科別連結'] = { url: full.deptUrl }

      if (Object.keys(properties).length === 0) { console.log(`  ⚠ ${c.name}：無可寫入欄位，略過`); continue }

      await notion.pages.update({ page_id: c.id, properties })
      console.log(`  ✓ ${c.name}：補上 ${Object.keys(properties).join('、')}`)
      ok++
    } catch (e) {
      console.log(`  ✗ ${c.name}：${e.message}`)
      failed++
    }
    await sleep(150)
  }
  console.log(`\n完成：成功 ${ok} 筆，失敗 ${failed} 筆`)
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
