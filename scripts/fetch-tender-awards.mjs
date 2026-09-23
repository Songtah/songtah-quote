/**
 * scripts/fetch-tender-awards.mjs — 逐案補決標結果（得標廠商、決標金額、底價、同場競標）
 *
 * 為什麼要另外跑：清單頁一律沒有金額與廠商，只有決標公告的**明細頁**才有，
 * 而明細頁有機器人驗證，短時間連抓十幾次就會鎖 IP 數十分鐘。
 * 所以做法是「少量多次、被擋就停手」，並用多個平行 Action job（各自不同 IP）分攤。
 *
 * 流程：向系統要一批缺決標的案子 → 用案號查決標公告（清單層級，不受限流）
 *      → 抓該公告明細頁 → 回送系統。查不到決標的也回報查核日，避免每輪重查。
 *
 * 環境變數：APP_URL、DAILY_REPORT_SECRET、LIMIT（預設 25）、SHARD／OF（分片）
 */
import { findAwardByJobNumber, fetchDetail } from '../lib/tender-pcc.ts'

const APP_URL = process.env.APP_URL ?? 'https://songtah-quote.vercel.app'
const SECRET = process.env.DAILY_REPORT_SECRET ?? ''
const LIMIT = Number(process.env.LIMIT) || 25
const SHARD = Number(process.env.SHARD) || 0
const OF = Number(process.env.OF) || 1
if (!SECRET) { console.error('缺少 DAILY_REPORT_SECRET'); process.exit(1) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const one = (m, k) => m.get(k)?.[0] ?? ''
const money = (t) => { const m = (t ?? '').replace(/,/g, '').match(/(\d+)\s*元/); return m ? Number(m[1]) : null }
const rocToISO = (s) => { const m = (s ?? '').match(/(\d{2,3})\/(\d{2})\/(\d{2})/); return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : '' }
const parseArea = (addr) => ({
  city: (addr.match(/(台北市|臺北市|新北市|基隆市|桃園市|新竹市|新竹縣|苗栗縣|台中市|臺中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/)?.[1] ?? '').replace(/台/, '臺'),
  district: addr.match(/[市縣]\s*([一-龥]{1,3}[區鄉鎮市])/)?.[1] ?? '',
})

const started = Date.now()
const res = await fetch(`${APP_URL}/api/cron/ingest-tenders?mode=award&limit=${LIMIT}&shard=${SHARD}&of=${OF}`,
  { headers: { 'x-cron-secret': SECRET } })
if (!res.ok) { console.error(`取待補清單失敗 ${res.status}`); process.exit(1) }
const { pending = [] } = await res.json()
console.log(`分片 ${SHARD}/${OF}：待補 ${pending.length} 案`)
if (pending.length === 0) process.exit(0)

const records = []
const checkedPageIds = []
let blocked = false, noAward = 0

for (const row of pending) {
  const roc = Number(row.date.slice(0, 4)) - 1911
  let award = null
  try {
    // 決標公告可能落在隔年（年底招標、隔年決標），兩個年度都找
    award = await findAwardByJobNumber(row.jobNumber, roc) ?? await findAwardByJobNumber(row.jobNumber, roc + 1)
  } catch (e) { console.log(`  查決標失敗 ${row.jobNumber}：${e?.message ?? e}`) }
  await sleep(500)
  if (!award) { noAward++; checkedPageIds.push(row.pageId); continue }

  const detail = await fetchDetail(award.path, award.pk).catch(() => null)
  if (detail === null) { blocked = true; console.log('  明細頁被機器人驗證擋下，本輪停手'); break }
  await sleep(4_000)

  const unitId = one(detail, '機關代碼')
  if (!unitId) { checkedPageIds.push(row.pageId); continue }
  const address = one(detail, '機關地址')
  const area = address ? parseArea(address) : parseArea(row.unitName)
  const vendors = detail.get('廠商名稱') ?? []
  const winner = one(detail, '得標廠商') || (one(detail, '是否得標') === '是' ? (vendors[0] ?? '') : '')

  records.push({
    id: `${unitId}|${row.jobNumber}`,
    unitId, jobNumber: row.jobNumber, unitName: row.unitName, title: row.title,
    type: award.type, date: award.date || row.date, category: one(detail, '標的分類'),
    matched: [], tier: 1,
    budget: money(one(detail, '預算金額')), budgetText: one(detail, '預算金額'),
    deadline: rocToISO(one(detail, '截止投標')) || row.deadline,
    address, city: area.city, district: area.district,
    contact: one(detail, '聯絡人'), phone: one(detail, '聯絡電話'),
    url: `https://web.pcc.gov.tw/prkms/urlSelector/common/${award.path}?pk=${award.pk}`,
    winner,
    awardAmount: money(one(detail, '總決標金額') || one(detail, '決標金額')),
    basePrice: money(one(detail, '底價金額')),
    bidders: vendors,
  })
  checkedPageIds.push(row.pageId)
}

console.log(`補到決標 ${records.length} 案、查無決標 ${noAward} 案${blocked ? '（中途被擋）' : ''}`)
const post = await fetch(`${APP_URL}/api/cron/ingest-tenders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
  body: JSON.stringify({ records, checkedPageIds, meta: {} }),
})
console.log(`回送 ${post.status}：${(await post.text()).slice(0, 300)}`)
console.log(`耗時 ${((Date.now() - started) / 1000).toFixed(0)} 秒`)
if (!post.ok) process.exit(1)
