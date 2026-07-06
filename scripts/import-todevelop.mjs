/**
 * scripts/import-todevelop.mjs — 待開發機構全量匯入 Notion 客戶庫
 *
 * 資料源:Redis `medical-monitor:last-result` 的 newOpenings(監控頁看到的同一份)。
 * 每筆依 data/bas-cache.json 反查 basSeq → fetchBasFull 帶入完整地址/電話/健保特約
 * + 機構資料/醫事人員連結/診療科別連結,並標 開發階段=線索、開發來源=BAS新開業。
 *
 * 用法:
 *   node --env-file=.env.local scripts/import-todevelop.mjs             # dry-run 唯讀盤點
 *   node --env-file=.env.local scripts/import-todevelop.mjs --execute   # 實際建立 Notion 頁
 */
import { Client } from '@notionhq/client'
import { fetchBasFull } from '../lib/mohw-bas.mjs'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const EXECUTE = process.argv.includes('--execute')
// --file <path>:監控比對結果 JSON(由正式站 GET /api/admin/medical-monitor 存下)
const fileIdx = process.argv.indexOf('--file')
const RESULT_FILE = fileIdx > -1 ? process.argv[fileIdx + 1] : null
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const dbId = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? process.env.NOTION_CUSTOMERS_DB ?? '').replace(/-/g, '')

const KIND_TO_TYPE = {
  '牙醫一般診所': '牙醫診所', '牙醫診所': '牙醫診所', '牙醫專科診所': '牙醫診所',
  '牙體技術所': '牙體技術所',
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadSeqByCode() {
  const map = new Map()
  const p = 'data/bas-cache.json'
  if (!existsSync(p)) return map
  const cache = JSON.parse(readFileSync(p, 'utf8'))
  for (const [key, v] of Object.entries(cache)) {
    if (!v?.code) continue
    const [basSeq, zoneSeq] = key.split('__')
    if (basSeq && zoneSeq) map.set(v.code, { basSeq, zoneSeq })
  }
  return map
}

/** 全庫掃描既有客戶的機構代碼(寫入前防重的權威來源,不用快取) */
async function loadExistingCodes() {
  const codes = new Set()
  let cursor
  do {
    const res = await notion.databases.query({
      database_id: dbId, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results) {
      const code = page.properties?.['機構代碼']?.rich_text?.map((t) => t.plain_text).join('').trim()
      if (code) codes.add(code)
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return codes
}

async function main() {
  if (!dbId) throw new Error('NOTION_CUSTOMERS_SYSTEM_DB 未設定')

  if (!RESULT_FILE || !existsSync(RESULT_FILE)) throw new Error('請以 --file <monitor-result.json> 提供監控比對結果')
  const result = JSON.parse(readFileSync(RESULT_FILE, 'utf8'))
  if (!result?.newOpenings) throw new Error('檔案內容不含 newOpenings')
  const all = [
    ...(result.newOpenings.clinics ?? []),
    ...(result.newOpenings.labs ?? []),
    ...(result.newOpenings.hospitals ?? []),
  ]
  const seqByCode = loadSeqByCode()
  console.log(`監控比對時間: ${result.computedAt}(快照月份 ${result.snapshotMonth})`)
  console.log(`待開發機構: ${all.length} 筆(診所 ${result.newOpenings.clinics?.length ?? 0} / 牙技所 ${result.newOpenings.labs?.length ?? 0} / 醫院 ${result.newOpenings.hospitals?.length ?? 0})`)

  console.log('掃描既有客戶機構代碼(防重)…')
  const existing = await loadExistingCodes()
  console.log(`既有客戶代碼: ${existing.size} 筆`)

  const todo = all.filter((i) => i.code && !existing.has(i.code))
  const dupes = all.length - todo.length
  const withSeq = todo.filter((i) => seqByCode.has(i.code)).length
  console.log(`\n計畫: 建立 ${todo.length} 筆(已存在跳過 ${dupes});其中 ${withSeq} 筆可反查 BAS 詳細頁帶完整資料,${todo.length - withSeq} 筆只帶快照基本欄位`)
  console.log('樣本前 5 筆:', JSON.stringify(todo.slice(0, 5).map((i) => ({ code: i.code, name: i.name, kind: i.kind, city: i.city, district: i.district })), null, 2))

  if (!EXECUTE) { console.log('\n(dry-run 結束,加 --execute 實際匯入)'); return }

  let ok = 0, fullOk = 0, failed = []
  for (const [idx, inst] of todo.entries()) {
    try {
      const seq = seqByCode.get(inst.code)
      let full = null
      if (seq) {
        try { full = await fetchBasFull(seq); await sleep(200) } catch { full = null }
      }
      if (full) fullOk++
      await notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          '客戶名稱': { title: [{ text: { content: inst.name } }] },
          ...(inst.city ? { '縣市': { select: { name: inst.city } } } : {}),
          '行政區':   { rich_text: [{ text: { content: inst.district ?? '' } }] },
          '地址':     { rich_text: [{ text: { content: full?.address || inst.address || '' } }] },
          '機構代碼': { rich_text: [{ text: { content: inst.code } }] },
          '客戶類型': { select: { name: KIND_TO_TYPE[inst.kind] ?? inst.kind } },
          '機構狀態': { select: { name: '開業' } },
          ...(full?.phone ? { '電話': { phone_number: full.phone } } : {}),
          ...(full ? { '健保特約': { checkbox: full.nhi } } : {}),
          ...(full?.infoUrl      ? { '機構資料':     { url: full.infoUrl } }      : {}),
          ...(full?.personnelUrl ? { '醫事人員連結': { url: full.personnelUrl } } : {}),
          ...(full?.deptUrl      ? { '診療科別連結': { url: full.deptUrl } }      : {}),
          '開發階段': { select: { name: '線索' } },
          '開發來源': { select: { name: 'BAS新開業' } },
        },
      })
      ok++
      console.log(`  ✓ [${idx + 1}/${todo.length}] ${inst.name}${full ? '(完整)' : '(基本)'}`)
    } catch (e) {
      failed.push({ code: inst.code, name: inst.name, error: e?.message })
      console.log(`  ✗ [${idx + 1}/${todo.length}] ${inst.name}: ${e?.message}`)
    }
  }

  // 註:customers-with-codes-v1 Redis 快取(1 小時 TTL)在正式站,本機無法直接失效;
  // 一小時後或下次 ?refresh=1 重新比對,這批已匯入者就會從「待開發」消失。

  console.log(`\n✅ 完成: 建立 ${ok}/${todo.length} 筆(完整資料 ${fullOk} 筆,基本 ${ok - fullOk} 筆),失敗 ${failed.length} 筆`)
  if (failed.length) {
    writeFileSync('scripts/import-todevelop-failed.json', JSON.stringify(failed, null, 2))
    console.log('失敗清單: scripts/import-todevelop-failed.json')
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
