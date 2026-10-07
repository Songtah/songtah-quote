/**
 * 補查「已從衛福部開業列表消失」機構的真實狀態（歇業／停業／其實仍開業），寫回 data/bas-cache.json。
 * 每月快照（scripts/clinic-monitor.mjs 步驟 3b）會自動做同一件事；這支是手動立即補查用。
 *
 *   node scripts/refresh-gone-status.mjs           # 查衛福部並列出結果，不寫檔
 *   node scripts/refresh-gone-status.mjs --write   # 寫回 data/bas-cache.json
 *
 * 「消失」＝代碼在快取裡、但不在目前 data/clinic-snapshot.json（開業列表）中。
 */
import { readFileSync, writeFileSync } from 'fs'
import { refreshGoneStatuses } from '../lib/mohw-bas.mjs'

const WRITE = process.argv.includes('--write')
const CACHE = 'data/bas-cache.json', SNAP = 'data/clinic-snapshot.json'

const cache = JSON.parse(readFileSync(CACHE, 'utf8'))
const snap = JSON.parse(readFileSync(SNAP, 'utf8'))
if (snap.pendingRemaining > 0 || snap.labsStale) {
  console.error(`⚠ 快照不完整（未解析 ${snap.pendingRemaining}、牙技所沿用上月 ${!!snap.labsStale}）→ 部分開業機構會被誤當成消失，先跑完快照再補查。`)
  process.exit(1)
}
const listed = new Set(Object.keys(snap.codes))

const r = await refreshGoneStatuses(cache, {
  isGone: (e) => !listed.has(e.code), recheckDays: 0, limit: 1000, log: (m) => console.log(m),
})
const gone = Object.values(cache).filter((e) => e.code && !listed.has(e.code) && e.statusCheckedAt)
const by = {}; for (const e of gone) by[e.status || '(空)'] = (by[e.status || '(空)'] || 0) + 1
console.log(`\n候選 ${r.candidates}、查到 ${r.checked}、狀態變更 ${r.changed}、失敗 ${r.failed}`)
console.log('消失機構的真實狀態：', Object.entries(by).map(([k, v]) => `${k} ${v}`).join('、'))

if (WRITE) { writeFileSync(CACHE, JSON.stringify(cache, null, 1)); console.log(`已寫回 ${CACHE}`) }
else console.log('（未寫檔；確認後加 --write）')
