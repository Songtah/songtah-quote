/**
 * scripts/fetch-tenders.mjs — 在 GitHub Action 端抓標案，再回送系統
 *
 * 為什麼不在 Vercel 抓：上游（pcc-api.openfun.app）對雲端伺服器 IP 回 403，
 * 實測帶上瀏覽器標頭仍被擋（本機與 Action runner 正常）。
 * 因此改成「Action 抓 → POST 回系統 → 系統比對客戶並寫 Notion」。
 *
 * 用法：
 *   node --env-file=... npx tsx scripts/fetch-tenders.mjs            # 增量（近 5 天）
 *   FULL=1 DAYS=120 npx tsx scripts/fetch-tenders.mjs                # 回補
 * 需環境變數：APP_URL、DAILY_REPORT_SECRET
 */
import { fetchTendersByDateRange, fetchOurBids } from '../lib/tender-source.ts'

const APP_URL = process.env.APP_URL ?? 'https://songtah-quote.vercel.app'
const SECRET = process.env.DAILY_REPORT_SECRET ?? ''
const DAYS = Number(process.env.DAYS) || (process.env.FULL === '1' ? 120 : 5)

if (!SECRET) { console.error('缺少 DAILY_REPORT_SECRET'); process.exit(1) }

const started = Date.now()
const { records, scannedDays, scannedRecords, failedDays, firstError } =
  await fetchTendersByDateRange({ days: DAYS, withDetail: true })
console.log(`掃 ${scannedDays} 天 / ${scannedRecords} 則公告 → 牙科相關 ${records.length} 案（失敗 ${failedDays} 天${firstError ? `，首個錯誤 ${firstError}` : ''}）`)

if (failedDays === scannedDays) {
  console.error('全部日期抓取失敗，不回送（避免把空結果當成正常）')
  process.exit(1)
}

const ourBids = await fetchOurBids('崧達')
console.log(`崧達投標紀錄：${ourBids.size} 案`)

const res = await fetch(`${APP_URL}/api/cron/ingest-tenders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
  body: JSON.stringify({
    records,
    ourBidIds: Array.from(ourBids),
    meta: { scannedDays, scannedRecords, failedDays, firstError },
  }),
})
const out = await res.text()
console.log(`回送 ${res.status}：${out.slice(0, 500)}`)
console.log(`總耗時 ${((Date.now() - started) / 1000).toFixed(0)} 秒`)
if (!res.ok) process.exit(1)
