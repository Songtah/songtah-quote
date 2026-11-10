// Notion → Supabase 同步（客戶主檔、客情紀錄）。
// 預設 dry-run：只讀 Notion、印出筆數與對照樣本，不碰資料庫。
//   npx tsx scripts/db-sync-notion.mjs                 # dry-run
//   npx tsx scripts/db-sync-notion.mjs --schema        # 建表（可重複執行）
//   npx tsx scripts/db-sync-notion.mjs --write         # 真正 upsert
//   npx tsx scripts/db-sync-notion.mjs --verify        # 比對兩邊筆數
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const postgres = require('postgres')
const { DB } = await import('../lib/notion/shared.ts')

const args = new Set(process.argv.slice(2))
const WRITE = args.has('--write'), SCHEMA = args.has('--schema'), VERIFY = args.has('--verify')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = (WRITE || SCHEMA || VERIFY) ? postgres(process.env.DATABASE_URL, { prepare: false, max: 3, ssl: 'require' }) : null
if ((WRITE || SCHEMA || VERIFY) && !process.env.DATABASE_URL) { console.error('DATABASE_URL 未設定'); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function q(a) { for (let i = 0; ; i++) { try { return await notion.databases.query(a) } catch (e) { if (i >= 4 || e.code === 'validation_error') throw e; await sleep(1500 * (i + 1)) } } }
async function scan(id, filter, on) { let c; do { const r = await q({ database_id: id, page_size: 100, ...(filter ? { filter } : {}), ...(c ? { start_cursor: c } : {}) }); for (const p of r.results) on(p); c = r.has_more ? r.next_cursor : undefined } while (c) }

const txt = p => (p?.rich_text || p?.title || []).map(t => t.plain_text).join('').trim() || null
const sel = p => p?.select?.name ?? p?.status?.name ?? null
const multi = p => (p?.multi_select || []).map(o => o.name)
const num = p => (p?.number == null ? null : Math.trunc(p.number))
const bool = p => p?.checkbox === true
const url = p => p?.url || null
const phone = p => p?.phone_number || null
const date = p => p?.date?.start?.slice(0, 10) || null
const rel = p => (p?.relation || []).map(r => r.id)

function mapCustomer(pg) {
  const P = pg.properties
  return {
    notion_page_id: pg.id, name: txt(P['客戶名稱']) || '(無名稱)', customer_type: sel(P['客戶類型']), county: sel(P['縣市']),
    district: txt(P['行政區']), address: txt(P['地址']), phone: phone(P['電話']), institution_status: sel(P['機構狀態']),
    institution_code: txt(P['機構代碼']), dentist_count: num(P['牙醫師數']), technician_count: num(P['牙體技術師數']), trainee_count: num(P['牙體技術生數']),
    institution_url: url(P['機構資料']), departments_url: url(P['診療科別連結']), staff_url: url(P['醫事人員連結']), nhi_contracted: bool(P['健保特約']),
    dev_stage: sel(P['開發階段']), dev_source: sel(P['開發來源']), owner: sel(P['負責業務']), dev_status_tags: multi(P['開發狀態']),
    principal: txt(P['負責人']), opportunity_tags: multi(P['商機標籤']), departments: multi(P['診療科別']), related_company: txt(P['相關公司行號']),
    grade: sel(P['客戶等級']), has_lab: bool(P['附屬技工室']), erp_updated: bool(P['ERP 更新']),
    notion_created_at: pg.created_time, notion_updated_at: pg.last_edited_time, synced_at: new Date().toISOString(),
  }
}
function mapVisit(pg) {
  const P = pg.properties
  return {
    notion_page_id: pg.id, customer_notion_id: rel(P['🏥 牙科單位資料'])[0] || null, unit_name: txt(P['單位名稱']) || '(無名稱)',
    visit_date: date(P['日期']), salesperson: sel(P['業務人員']), content: txt(P['拜訪內容']), address: txt(P['地址']),
    interaction_type: sel(P['互動類型']), reaction: sel(P['客戶反應']), needs_follow_up: bool(P['是否需追蹤']), next_follow_up: date(P['下次追蹤日']),
    follow_up_closed: bool(P['追蹤已結案']), contact_name: txt(P['聯絡人']), contact_phone: phone(P['聯絡電話']), competitors: multi(P['競品']),
    customer_tags: multi(P['客戶標籤']), next_action: txt(P['後續動作']), purpose: sel(P['互動目的']), visit_nature: sel(P['拜訪性質']), status: sel(P['狀態']),
    interested_product_ids: rel(P['有興趣的產品']), recommended_product_ids: rel(P['推薦產品']),
    notion_created_at: pg.created_time, notion_updated_at: pg.last_edited_time, synced_at: new Date().toISOString(),
  }
}

if (SCHEMA) {
  await sql.unsafe(readFileSync(new URL('../db/migrations/001_customers_visits.sql', import.meta.url), 'utf8'))
  console.log('資料表已建立／確認')
  await sql.end(); process.exit(0)
}
if (VERIFY) {
  const [c] = await sql`select count(*)::int n, max(synced_at) t from customers`
  const [v] = await sql`select count(*)::int n, count(customer_id)::int linked, max(synced_at) t from visits`
  const [d] = await sql`select count(*)::int n from (select institution_code from customers where institution_code is not null group by 1 having count(*)>1) x`
  console.log(`資料庫：客戶 ${c.n} 筆（最後同步 ${c.t}）；客情 ${v.n} 筆，已連客戶 ${v.linked}（最後同步 ${v.t}）；重複機構代碼 ${d.n} 組`)
  await sql.end(); process.exit(0)
}

// ---- 讀 Notion ----
const t0 = Date.now()
const customers = new Map()
const cdb = await notion.databases.retrieve({ database_id: DB.customers })
for (const o of cdb.properties['縣市'].select.options) await scan(DB.customers, { property: '縣市', select: { equals: o.name } }, p => customers.set(p.id, mapCustomer(p)))
await scan(DB.customers, { property: '縣市', select: { is_empty: true } }, p => customers.set(p.id, mapCustomer(p)))
const visits = new Map()
for (const f of [{ property: '日期', date: { before: '2026-06-01' } }, { property: '日期', date: { on_or_after: '2026-06-01' } }, { property: '日期', date: { is_empty: true } }])
  await scan(DB.visits, f, p => visits.set(p.id, mapVisit(p)))
const unlinked = [...visits.values()].filter(v => !v.customer_notion_id || !customers.has(v.customer_notion_id)).length
console.log(`Notion 讀取完成：客戶 ${customers.size} 筆、客情 ${visits.size} 筆（未連客戶 ${unlinked}），${Math.round((Date.now() - t0) / 1000)} 秒`)

if (!WRITE) {
  const sample = [...customers.values()][0], vs = [...visits.values()][0]
  const mask = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : Array.isArray(v) ? `[${v.length}]` : typeof v === 'boolean' ? v : typeof v === 'number' ? v : String(v).length > 0 ? `文字${String(v).length}字` : '']))
  console.log('客戶對照樣本（只顯示型別與長度）：', JSON.stringify(mask(sample)))
  console.log('客情對照樣本（只顯示型別與長度）：', JSON.stringify(mask(vs)))
  console.log('dry-run 結束，未寫入任何資料。加 --write 才會寫入。')
  process.exit(0)
}

// ---- 寫入 ----
const [run] = await sql`insert into sync_runs (source) values ('notion') returning id`
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const crows = [...customers.values()]
const ccols = Object.keys(crows[0])
let cu = 0
for (const part of chunk(crows, 200)) {
  const r = await sql`insert into customers ${sql(part, ...ccols)} on conflict (notion_page_id) do update set ${sql(Object.fromEntries(ccols.filter(c => c !== 'notion_page_id').map(c => [c, sql(`excluded.${c}`)])))}`
  cu += r.count
}
const idMap = new Map((await sql`select id, notion_page_id from customers`).map(r => [r.notion_page_id, r.id]))
const vrows = [...visits.values()].map(v => ({ ...v, customer_id: v.customer_notion_id ? idMap.get(v.customer_notion_id) ?? null : null }))
const vcols = Object.keys(vrows[0])
let vu = 0
for (const part of chunk(vrows, 200)) {
  const r = await sql`insert into visits ${sql(part, ...vcols)} on conflict (notion_page_id) do update set ${sql(Object.fromEntries(vcols.filter(c => c !== 'notion_page_id').map(c => [c, sql(`excluded.${c}`)])))}`
  vu += r.count
}
// Notion 已封存／刪除的頁面：這次沒掃到的列一併移除（防呆：單一表缺少超過 5% 就不刪，只警告）
let removed = { customers: 0, visits: 0 }
for (const [table, seen] of [['customers', customers], ['visits', visits]]) {
  const have = await sql`select notion_page_id from ${sql(table)}`
  const gone = have.map(r => r.notion_page_id).filter(id => !seen.has(id))
  if (gone.length > have.length * 0.05) { console.log(`警告：${table} 有 ${gone.length} 筆未在 Notion 出現（超過 5%），未刪除，請人工檢查`); continue }
  if (gone.length) { const r = await sql`delete from ${sql(table)} where notion_page_id in ${sql(gone)}`; removed[table] = r.count }
}
await sql`update sync_runs set notes = ${JSON.stringify({ removed })} where id = ${run.id}`
console.log(`已移除 Notion 不再存在的列：客戶 ${removed.customers}、客情 ${removed.visits}`)
await sql`update sync_runs set finished_at = now(), customers_seen = ${customers.size}, customers_upserted = ${cu}, visits_seen = ${visits.size}, visits_upserted = ${vu}, visits_unlinked = ${unlinked} where id = ${run.id}`
console.log(`寫入完成：客戶 ${cu}、客情 ${vu}（未連客戶 ${unlinked}）。同步紀錄 #${run.id}`)
await sql.end()
