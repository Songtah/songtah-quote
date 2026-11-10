// 整庫搬進 notion_pages（原樣保存 Notion JSON）。用法：npx tsx scripts/db-backfill-notion-store.mjs <DB 鍵或 id> ...
// 鍵＝lib/notion/shared.ts 的 DB 物件鍵，或 NOTION_*_DB 環境變數名。可重複執行（upsert）。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const postgres = require('postgres')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 2 })
const { DB } = await import('../lib/notion/shared.ts')
const bare = (id) => (id ?? '').replace(/-/g, '').toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function q(a) { for (let i = 0; ; i++) { try { const r = await notion.databases.query(a); await sleep(350); return r } catch (e) { if (i >= 10) throw e; await sleep(3000 * (i + 1)) } } }
for (const key of process.argv.slice(2)) {
  const id = DB[key] ?? process.env[key] ?? key
  if (!id) { console.log(`${key}: 沒有 id，跳過`); continue }
  const db = await notion.databases.retrieve({ database_id: id })
  const title = db.title.map((t) => t.plain_text).join('').replace(/（2026-11-10 已封存.*$/, '')
  await sql`insert into notion_databases (db_id, title, schema) values (${bare(db.id)}, ${title}, ${sql.json(db.properties)}) on conflict (db_id) do update set title = excluded.title, schema = excluded.schema`
  let c, n = 0, rows = []
  do { const r = await q({ database_id: id, page_size: 100, ...(c ? { start_cursor: c } : {}) }); for (const p of r.results) { n++; rows.push({ page_id: bare(p.id), db_id: bare(db.id), properties: p.properties, created_time: p.created_time, last_edited_time: p.last_edited_time, archived: !!p.archived, cover: p.cover ?? null, icon: p.icon ?? null }) } c = r.has_more ? r.next_cursor : undefined } while (c)
  if (n >= 10000) throw new Error(`${title} 達一萬筆，需分區`)
  for (let i = 0; i < rows.length; i += 100) { const part = rows.slice(i, i + 100).map((r) => ({ ...r, properties: sql.json(r.properties), cover: r.cover ? sql.json(r.cover) : null, icon: r.icon ? sql.json(r.icon) : null })); await sql`insert into notion_pages ${sql(part, 'page_id', 'db_id', 'properties', 'created_time', 'last_edited_time', 'archived', 'cover', 'icon')} on conflict (page_id) do update set properties = excluded.properties, last_edited_time = excluded.last_edited_time, archived = excluded.archived, cover = excluded.cover, icon = excluded.icon` }
  const types = {}; for (const p of Object.values(db.properties)) types[p.type] = (types[p.type] ?? 0) + 1
  const files = rows.reduce((a, r) => a + Object.values(r.properties).filter((p) => p.type === 'files').reduce((b, p) => b + (p.files ?? []).filter((f) => f.type === 'file').length, 0), 0)
  console.log(`${key}「${title}」：${n} 筆已搬；欄位型別 ${JSON.stringify(types)}${files ? `；Notion 代管檔案 ${files} 個（需另搬）` : ''}`)
}
await sql.end()
