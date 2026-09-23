/**
 * scripts/backfill-tenders.mjs — 回補歷史招標公告（近 N 年）
 *
 * 為什麼能回補：政府電子採購網的「基本查詢」支援標案名稱關鍵字＋公告日期區間，
 * 按月切片就不會撞到每頁 100 筆的上限（公告查詢只能選年度、且分頁需要網站 session，取不到）。
 * 清單本身就帶預算金額與採購性質，所以這一步完全不需要碰受限流的明細頁。
 *
 * 決標結果（得標廠商、決標金額、底價）不在清單上，只能逐案進明細頁，
 * 由 scripts/fetch-tender-awards.mjs 慢慢補。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/backfill-tenders.mjs                 # 預覽（不寫入）
 *   npx tsx --env-file=.env.local scripts/backfill-tenders.mjs --apply         # 寫入
 *   ... --years=5 --from=2021-10
 */
import { searchTenderMonth, hitsToRecords } from '../lib/tender-pcc.ts'
import { TENDER_KEYWORDS_PRIMARY, TENDER_KEYWORDS_SECONDARY } from '../lib/tender-source.ts'
import { ingestTenders } from '../lib/notion/tenders.ts'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const APPLY = process.argv.includes('--apply')
const years = Number(arg('years', 5))
const now = new Date()
const to = arg('to', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const from = arg('from', (() => {
  const d = new Date(Date.UTC(now.getFullYear() - years, now.getMonth(), 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
})())

const months = []
for (let d = new Date(`${from}-01T00:00:00Z`); `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` <= to; d.setUTCMonth(d.getUTCMonth() + 1)) {
  months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
}
const keywords = [...TENDER_KEYWORDS_PRIMARY, ...TENDER_KEYWORDS_SECONDARY]
console.log(`回補範圍 ${from} ～ ${to}（${months.length} 個月）× ${keywords.length} 個關鍵字 = ${months.length * keywords.length} 次查詢`)

const byId = new Map()
let queries = 0, failed = 0, firstError = ''
const started = Date.now()

for (const ym of months) {
  let monthHits = 0
  for (const kw of keywords) {
    queries++
    try {
      const hits = await searchTenderMonth(kw, ym)
      monthHits += hits.length
      for (const rec of hitsToRecords(hits)) {
        const prev = byId.get(rec.id)
        if (!prev) { byId.set(rec.id, rec); continue }
        for (const k of rec.matched) if (!prev.matched.includes(k)) prev.matched.push(k)
        // 同案的更正公告日期較新，公告事實以較新的為準
        if (rec.date > prev.date) Object.assign(prev, rec, { matched: prev.matched })
      }
    } catch (e) {
      failed++
      if (!firstError) firstError = `${ym}/${kw}: ${e?.message ?? e}`
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.log(`  ${ym}  查到 ${monthHits} 則、累計收錄 ${byId.size} 案（${((Date.now() - started) / 1000).toFixed(0)}s）`)
}

const all = Array.from(byId.values())
const byYear = all.reduce((a, r) => { const y = r.date.slice(0, 4); a[y] = (a[y] ?? 0) + 1; return a }, {})
console.log(`\n查詢 ${queries} 次（失敗 ${failed}${firstError ? `，首個錯誤 ${firstError}` : ''}）→ 收錄 ${all.length} 案`)
console.log('依年份：', Object.entries(byYear).sort().map(([y, n]) => `${y}:${n}`).join('  '))
console.log('第二級關鍵字（設備耗材）：', all.filter((r) => r.tier === 2).length, '案')

if (!APPLY) { console.log('\n（預覽，加 --apply 才會寫入 Notion）'); process.exit(0) }

// 分年寫入：中途失敗時已寫的年度不用重來
for (const y of Object.keys(byYear).sort()) {
  const chunk = all.filter((r) => r.date.startsWith(y))
  const t = Date.now()
  const snap = await ingestTenders(chunk, { dataSource: '歷史回補' })
  console.log(`${y} 年寫入 ${chunk.length} 案 → DB 共 ${snap.records.length} 列、配對客戶 ${snap.records.filter((r) => r.customerId).length} 案（${((Date.now() - t) / 1000).toFixed(0)}s）`)
}
console.log(`完成，總耗時 ${((Date.now() - started) / 60000).toFixed(1)} 分`)
