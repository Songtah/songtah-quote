/**
 * scripts/fetch-tenders.mjs — 在 GitHub Action 端抓標案，再回送系統
 *
 * 為什麼在這裡抓：政府電子採購網官網（web.pcc.gov.tw）在 Action runner 端可正常存取，
 * 而明細頁短時間多抓就會跳機器人驗證並鎖 IP——把這個風險留在 runner，不要壓在正式站上。
 * 流程：Action 抓 → POST 回系統 → 系統比對客戶並寫 Notion。
 *
 * 用法：
 *   node --env-file=... npx tsx scripts/fetch-tenders.mjs            # 增量（近 5 天）
 *   FULL=1 DAYS=120 npx tsx scripts/fetch-tenders.mjs                # 回補
 * 需環境變數：APP_URL、DAILY_REPORT_SECRET
 */
import { fetchDentalTendersFromPcc, enrichPendingTenders } from '../lib/tender-pcc.ts'

const APP_URL = process.env.APP_URL ?? 'https://songtah-quote.vercel.app'
const SECRET = process.env.DAILY_REPORT_SECRET ?? ''
const DAYS = Number(process.env.DAYS) || (process.env.FULL === '1' ? 120 : 5)

if (!SECRET) { console.error('缺少 DAILY_REPORT_SECRET'); process.exit(1) }

const started = Date.now()
const from = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10)
const res = await fetchDentalTendersFromPcc({ from })
console.log(`查詢 ${res.queries} 次（失敗 ${res.failedQueries}）→ ${res.records.length} 案（候選 ${res.candidates}、補到明細 ${res.enriched}` +
  `${res.detailBlocked ? '、明細頁被擋' : ''}）${res.firstError ? `｜${res.firstError}` : ''}`)

if (res.failedQueries === res.queries) {
  console.error('全部查詢失敗，不回送（避免把空結果當成正常）')
  process.exit(1)
}

// 沒抓到案子就不回送（API 會擋空資料），但仍繼續跑補明細
const post = res.records.length === 0 ? { ok: true, status: 204, text: async () => '本輪沒有新案件' } : await fetch(`${APP_URL}/api/cron/ingest-tenders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
  body: JSON.stringify({
    records: res.records,
    meta: {
      scannedDays: res.queries,
      scannedRecords: res.candidates,
      failedDays: res.failedQueries,
      firstError: res.firstError || (res.detailBlocked ? '明細頁被官網機器人驗證擋下，剩餘案件留待下輪' : ''),
    },
  }),
})
const out = await post.text()
console.log(`回送 ${post.status}：${out.slice(0, 500)}`)
if (!post.ok) process.exit(1)

// 補明細：每輪少量補幾筆先前沒抓到明細的案子（官網明細頁限流嚴格，只能細水長流）
if (!res.detailBlocked) {
  const p = await fetch(`${APP_URL}/api/cron/ingest-tenders?limit=5`, { headers: { 'x-cron-secret': SECRET } })
  const { pending = [] } = p.ok ? await p.json() : {}
  if (pending.length) {
    const fix = await enrichPendingTenders(pending)
    console.log(`待補明細 ${pending.length} 筆 → 補齊 ${fix.records.length} 筆${fix.blocked ? '（中途被機器人驗證擋下）' : ''}`)
    if (fix.records.length) {
      const r2 = await fetch(`${APP_URL}/api/cron/ingest-tenders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
        body: JSON.stringify({ records: fix.records, meta: {} }),
      })
      console.log(`補明細回送 ${r2.status}：${(await r2.text()).slice(0, 300)}`)
    }
  }
}
console.log(`總耗時 ${((Date.now() - started) / 1000).toFixed(0)} 秒`)
