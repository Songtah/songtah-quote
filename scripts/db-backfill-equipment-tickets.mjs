// 一次性：Notion 設備、工單 → 資料庫（可重複執行，以 notion_page_id upsert）。未對應的欄位放 extra。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const postgres = require('postgres')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 2 })
const { DB } = await import('../lib/notion/shared.ts')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function q(a) { for (let i = 0; ; i++) { try { const r = await notion.databases.query(a); await sleep(350); return r } catch (e) { if (i >= 10) throw e; await sleep(3000 * (i + 1)) } } }
async function all(id) { const out = []; let c; do { const r = await q({ database_id: id, page_size: 100, ...(c ? { start_cursor: c } : {}) }); out.push(...r.results); c = r.has_more ? r.next_cursor : undefined } while (c); if (out.length >= 10000) throw new Error('達一萬筆'); return out }
const txt = (P, k) => (P[k]?.rich_text ?? P[k]?.title ?? []).map((t) => t.plain_text).join('') || null
const sel = (P, k) => P[k]?.select?.name ?? P[k]?.status?.name ?? null
const rel = (P, k) => (P[k]?.relation ?? []).map((r) => r.id)
const date = (P, k) => P[k]?.date?.start?.slice(0, 10) ?? null
const files = (P, k) => (P[k]?.files ?? []).map((f) => ({ name: f.name, type: f.type, url: f.type === 'external' ? f.external?.url : f.file?.url, expires: f.file?.expiry_time ?? null }))
const KNOWN_E = new Set(['序號', '客戶名稱', '機型', 'TeamViewer ID', 'Zirkonzahn 軟體 模組', 'Support ID', '產品狀態', 'Dongle 序號', '生產商', '備註', '保固結束日期', '啟用日期', '客戶單位'])
const KNOWN_T = new Set(['解決方案', '影像或照片資料(售後)', '人員', '設備資料', '編號', '備註', '業務窗口', '建立日期', '生產商', '技術人員', '狀態', '情境描述', '故障分類', '關鍵料件', '影像或照片資料(客戶)', '案件標題', '聯絡人', '原因', '時效指標', '品牌', '優先級', '預計維修日期（外派）', '產品資料庫', '🏥 牙科單位資料', '技術支援對口', '客戶單位'])
const extraOf = (P, known) => Object.fromEntries(Object.entries(P).filter(([k, v]) => !known.has(k) && !['formula', 'rollup'].includes(v.type)).map(([k, v]) => [k, v[v.type]]))

const eq = await all(DB.equipment)
const erows = eq.map((p) => { const P = p.properties; return {
  notion_page_id: p.id, customer_unit: txt(P, '客戶單位') ?? '', customer_notion_id: rel(P, '客戶名稱')[0] ?? null, product_notion_id: rel(P, '機型')[0] ?? null,
  software_module_ids: rel(P, 'Zirkonzahn 軟體 模組'), serial_number: txt(P, '序號'), teamviewer_id: txt(P, 'TeamViewer ID'), support_id: txt(P, 'Support ID'), dongle_serial: txt(P, 'Dongle 序號'),
  status: sel(P, '產品狀態'), manufacturer: sel(P, '生產商'), note: txt(P, '備註'), warranty_end: date(P, '保固結束日期'), activation_date: date(P, '啟用日期'),
  notion_created_at: p.created_time, notion_updated_at: p.last_edited_time, extra: extraOf(P, KNOWN_E) } })
for (let i = 0; i < erows.length; i += 200) { const part = erows.slice(i, i + 200); const cols = Object.keys(part[0]); await sql`insert into equipment ${sql(part, ...cols)} on conflict (notion_page_id) do update set ${sql.unsafe(cols.filter((c) => c !== 'notion_page_id').map((c) => `"${c}" = excluded."${c}"`).join(', '))}` }
console.log(`設備：Notion ${eq.length} 筆已寫入；無客戶關聯 ${erows.filter((r) => !r.customer_notion_id).length}、無機型 ${erows.filter((r) => !r.product_notion_id).length}`)

const tk = await all(DB.tickets)
let notionFiles = 0
const trows = tk.map((p) => { const P = p.properties; const fa = files(P, '影像或照片資料(售後)'), fc = files(P, '影像或照片資料(客戶)'); notionFiles += [...fa, ...fc].filter((f) => f.type === 'file').length; return {
  notion_page_id: p.id, number: P['編號']?.unique_id?.number ?? null, customer_unit: txt(P, '客戶單位') ?? '',
  customer_notion_id: rel(P, '🏥 牙科單位資料')[0] ?? null, equipment_notion_id: rel(P, '設備資料')[0] ?? null, product_notion_id: rel(P, '產品資料庫')[0] ?? null,
  technician_ids: rel(P, '技術人員'), people_ids: (P['人員']?.people ?? []).map((u) => u.id),
  title: txt(P, '案件標題'), fault_types: (P['故障分類']?.multi_select ?? []).map((o) => o.name), status: sel(P, '狀態'), priority: sel(P, '優先級'),
  scheduled_date: date(P, '預計維修日期（外派）'), created_date: date(P, '建立日期'), contact_name: txt(P, '聯絡人'), description: txt(P, '情境描述'),
  support_owner: sel(P, '技術支援對口'), sales_owner: sel(P, '業務窗口'), cause: txt(P, '原因'), solution: txt(P, '解決方案'), key_part: txt(P, '關鍵料件'), note: txt(P, '備註'), manufacturer: sel(P, '生產商'),
  files_after: fa, files_customer: fc, notion_created_at: p.created_time, notion_updated_at: p.last_edited_time, extra: extraOf(P, KNOWN_T) } })
const noNum = trows.filter((r) => r.number == null).length
let maxNum = Math.max(0, ...trows.map((r) => r.number ?? 0))
for (const r of trows) if (r.number == null) r.number = ++maxNum
for (let i = 0; i < trows.length; i += 200) { const part = trows.slice(i, i + 200); const cols = Object.keys(part[0]); await sql`insert into tickets ${sql(part, ...cols)} on conflict (notion_page_id) do update set ${sql.unsafe(cols.filter((c) => c !== 'notion_page_id' && c !== 'files_after' && c !== 'files_customer').map((c) => `"${c}" = excluded."${c}"`).join(', '))}` }
await sql`select setval('ticket_number_seq', ${maxNum}, true)`
console.log(`工單：Notion ${tk.length} 筆已寫入；最大編號 RMA-${maxNum}（無編號補發 ${noNum}）；Notion 代管檔案 ${notionFiles} 個（網址會過期，需另搬）；無客戶關聯 ${trows.filter((r) => !r.customer_notion_id).length}`)
const extras = new Set([...erows, ...trows].flatMap((r) => Object.keys(r.extra))); console.log('未對應欄位：', [...extras].join('、') || '無')
await sql.end()
