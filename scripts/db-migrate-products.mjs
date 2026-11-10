// 一次性：產品／系列／說明書 三庫搬進 notion_pages；產品頁第一張圖（設備縮圖來源）與說明書檔案搬到 Vercel Blob。可重複執行。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const { put } = require('@vercel/blob')
const postgres = require('postgres')
const n = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 2 })
const bare = (id) => (id ?? '').replace(/-/g, '').toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function call(fn) { for (let i = 0; ; i++) { try { const r = await fn(); await sleep(340); return r } catch (e) { if (i >= 10 || e.code === 'object_not_found' || e.code === 'validation_error') throw e; await sleep(3000 * (i + 1)) } } }
const PROD = process.env.NOTION_PRODUCTS_SYSTEM_DB || process.env.NOTION_PRODUCTS_DB, SERIES = process.env.NOTION_SERIES_DB
const pdb = await call(() => n.databases.retrieve({ database_id: PROD }))
const MANUAL = pdb.properties['說明書資料庫'].relation.database_id
async function toBlob(url, path) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); const buf = Buffer.from(await res.arrayBuffer()); const b = await put(path, buf, { access: 'public', addRandomSuffix: true, contentType: res.headers.get('content-type') ?? undefined }); return b.url }
const imgUrl = (b) => b?.type === 'image' ? (b.image.type === 'file' ? b.image.file.url : b.image.external?.url) : ''
async function firstImage(pageId) {
  const top = (await call(() => n.blocks.children.list({ block_id: pageId, page_size: 20 }))).results
  for (const b of top) if (b.type === 'image') return imgUrl(b)
  for (const c of top.filter((b) => ['column_list', 'column'].includes(b.type))) {
    for (const ch of (await call(() => n.blocks.children.list({ block_id: c.id, page_size: 20 }))).results) {
      if (ch.type === 'image') return imgUrl(ch)
      if (ch.type === 'column') for (const g of (await call(() => n.blocks.children.list({ block_id: ch.id, page_size: 20 }))).results) if (g.type === 'image') return imgUrl(g)
    }
  }
  return ''
}
const existingCover = new Map((await sql`select page_id, cover from notion_pages where cover is not null`).map((r) => [r.page_id, r.cover]))
const usedByEquipment = new Set((await sql`select distinct replace(product_notion_id,'-','') pid from equipment where product_notion_id is not null`).map((r) => r.pid))
const ALL_THUMBS = process.argv.includes('--all-thumbs')
for (const [label, id] of [['產品', PROD], ['系列', SERIES], ['說明書', MANUAL]]) {
  if (!id) { console.log(label, '無 id'); continue }
  const db = await call(() => n.databases.retrieve({ database_id: id }))
  const title = db.title.map((t) => t.plain_text).join('').replace(/（2026-11-10 已封存.*$/, '')
  await sql`insert into notion_databases (db_id, title, schema) values (${bare(db.id)}, ${title}, ${sql.json(db.properties)}) on conflict (db_id) do update set title = excluded.title, schema = excluded.schema`
  let c, k = 0, thumbs = 0, files = 0, fail = 0
  do {
    const r = await call(() => n.databases.query({ database_id: id, page_size: 100, ...(c ? { start_cursor: c } : {}) }))
    for (const p of r.results) {
      k++
      const pid = bare(p.id); let cover = existingCover.get(pid) ?? p.cover ?? null
      if (label === '產品' && !cover && (ALL_THUMBS || usedByEquipment.has(pid))) {
        try { const u = await firstImage(p.id); if (u) { const stored = u.includes('blob.vercel-storage.com') ? u : await toBlob(u, `product-thumbs/${pid}`); cover = { type: 'external', external: { url: stored } }; thumbs++ } } catch { fail++ }
      }
      for (const [name, v] of Object.entries(p.properties)) if (v.type === 'files') {
        const out = []
        for (const f of v.files) { if (f.type !== 'file') { out.push(f); continue } try { const u = await toBlob(f.file.url, `manuals/${pid}/${(f.name || 'file').replace(/[^\w.\-一-鿿]+/g, '_')}`); out.push({ name: f.name, type: 'external', external: { url: u } }); files++ } catch { fail++; out.push(f) } }
        p.properties[name] = { ...v, files: out }
      }
      await sql`insert into notion_pages (page_id, db_id, properties, created_time, last_edited_time, archived, cover, icon) values (${pid}, ${bare(db.id)}, ${sql.json(p.properties)}, ${p.created_time}, ${p.last_edited_time}, ${!!p.archived}, ${cover ? sql.json(cover) : null}, ${p.icon ? sql.json(p.icon) : null})
        on conflict (page_id) do update set properties = excluded.properties, last_edited_time = excluded.last_edited_time, archived = excluded.archived, cover = coalesce(excluded.cover, notion_pages.cover)`
    }
    c = r.has_more ? r.next_cursor : undefined
  } while (c)
  console.log(`${label}「${title}」：${k} 筆已搬；縮圖 ${thumbs}、檔案 ${files}、失敗 ${fail}`)
}
await sql.end()
