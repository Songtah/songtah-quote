// 一次性：把 Notion「診所監控紀錄」(≥10,000 筆) 與「醫事數量趨勢」搬進資料庫。分區掃描避開一萬筆截斷。可重複執行（以 notion_page_id 去重）。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const postgres = require('postgres')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 3 })
const { DB } = await import('../lib/notion/shared.ts')
const MON = process.env.NOTION_CLINIC_MONITOR_DB, TREND = DB.medicalTrend
const TREND_ONLY = process.argv.includes('--trend-only')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function q(a) { for (let i = 0; ; i++) { try { const r = await notion.databases.query(a); await sleep(350); return r } catch (e) { if (i >= 10) throw e; const ra = Number(e?.headers?.get?.('retry-after') ?? e?.headers?.['retry-after']?.[0] ?? 0); await sleep(Math.max(ra * 1000, 3000 * (i + 1))) } } }
async function scan(id, filter, on) { let c, n = 0; do { const r = await q({ database_id: id, page_size: 100, ...(filter ? { filter } : {}), ...(c ? { start_cursor: c } : {}) }); for (const p of r.results) { on(p); n++ } c = r.has_more ? r.next_cursor : undefined } while (c); if (n >= 10000) throw new Error('分區仍達 1 萬筆：' + JSON.stringify(filter)); return n }
const txt = (p, k) => (p.properties[k]?.rich_text ?? p.properties[k]?.title ?? []).map((t) => t.plain_text).join('') || null
const db = TREND_ONLY ? { properties: { '異動類型': { select: { options: [] } } } } : await notion.databases.retrieve({ database_id: MON })
const types = db.properties['異動類型'].select.options.map((o) => o.name)
const have = new Set((await sql`select notion_page_id from monitor_records where notion_page_id is not null`).map((r) => r.notion_page_id))
let seen = 0, inserted = 0
const buf = []
const flush = async () => { while (buf.length) { const part = buf.splice(0, 500); const r = await sql`insert into monitor_records ${sql(part, 'notion_page_id', 'title', 'month', 'type', 'institution_code', 'nhi_name', 'customer_name', 'customer_url', 'address', 'specialty', 'term_date', 'created_at')} on conflict (notion_page_id) do nothing`; inserted += r.count } }
const on = (p) => {
  seen++; if (have.has(p.id)) return
  const P = p.properties
  buf.push({ notion_page_id: p.id, title: txt(p, '標題') ?? '', month: P['月份']?.date?.start ?? null, type: P['異動類型']?.select?.name ?? '未分類',
    institution_code: txt(p, '機構代碼'), nhi_name: txt(p, '健保名稱'), customer_name: txt(p, '客戶名稱'), customer_url: P['客戶頁面']?.url ?? null,
    address: txt(p, '地址'), specialty: txt(p, '診療科別'), term_date: P['終止日期']?.date?.start ?? null, created_at: p.created_time })
}
// 分區：異動類型 × 建立月份（created_time）
const months = []; for (let d = new Date('2026-01-01'); d <= new Date(); d.setMonth(d.getMonth() + 1)) months.push(new Date(d))
months.push(new Date(months[months.length - 1].getFullYear(), months[months.length - 1].getMonth() + 1, 1))
for (const t of (TREND_ONLY ? [] : [...types, null])) {
  for (let i = 0; i < months.length - 1; i++) {
    const a = months[i].toISOString(), b = months[i + 1].toISOString()
    const f = { and: [t ? { property: '異動類型', select: { equals: t } } : { property: '異動類型', select: { is_empty: true } }, { timestamp: 'created_time', created_time: { on_or_after: a } }, { timestamp: 'created_time', created_time: { before: b } }] }
    const n = await scan(MON, f, on); if (buf.length >= 500) await flush()
    if (n) console.log(`${t ?? '(無類型)'} ${a.slice(0, 7)}：${n}`)
  }
}
const early = TREND_ONLY ? 0 : await scan(MON, { timestamp: 'created_time', created_time: { before: '2026-01-01T00:00:00.000Z' } }, on); if (early) console.log('2026 以前：', early)
await flush()
console.log(`監控紀錄：Notion 讀到 ${seen} 筆，新寫入 ${inserted} 筆`)
// 趨勢
const trows = []
await scan(TREND, undefined, (p) => { const P = p.properties; const num = (k) => P[k]?.number ?? null
  trows.push({ month: txt(p, '月份'), recorded_at: P['紀錄時間']?.date?.start ?? p.created_time, total_clinics: num('全台_牙醫診所'), total_labs: num('全台_牙體技術所'), total_hospitals: num('全台_醫院'), total_schools: num('全台_學校'), cust_clinics: num('客戶_牙醫診所'), cust_labs: num('客戶_牙體技術所'), cust_hospitals: num('客戶_醫院'), cust_schools: num('客戶_學校'), customer_with_code: num('客戶有代碼'), in_bas_open: num('在BAS開業'), to_develop: num('待開發'), suspected_closures: num('疑似歇業'), hospital_unverified: num('醫院待確認'), code_changed: num('更換代碼'), inconsistent_data: num('資料不一致'), notion_page_id: p.id }) })
for (const r of trows.filter((r) => r.month)) await sql`insert into medical_trend ${sql(r)} on conflict (month) do update set ${sql(r)}`
console.log(`醫事數量趨勢：${trows.length} 筆已寫入`)
const [[c], [m]] = await Promise.all([sql`select count(*)::int n from monitor_records`, sql`select count(*)::int n from medical_trend`])
console.log(`資料庫現有：監控紀錄 ${c.n}、趨勢 ${m.n}`)
await sql.end()
