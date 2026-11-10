// 一次性：工單照片（Notion 代管檔案，網址 1 小時過期）下載後存到 Vercel Blob，改寫 tickets.files_* 的網址。可重複執行（已是 blob 網址者跳過）。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '.env.local' })
const { Client } = require('@notionhq/client')
const { put } = require('@vercel/blob')
const postgres = require('postgres')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 2 })
const DRY = !process.argv.includes('--execute')
const rows = await sql`select notion_page_id, number, files_after, files_customer from tickets where jsonb_array_length(files_after) > 0 or jsonb_array_length(files_customer) > 0`
let total = 0, moved = 0, skipped = 0, failed = 0
for (const r of rows) {
  // 重新抓頁面取得新鮮的簽名網址
  let page = null
  const out = { files_after: [], files_customer: [] }
  for (const [col, prop] of [['files_after', '影像或照片資料(售後)'], ['files_customer', '影像或照片資料(客戶)']]) {
    for (const f of r[col]) {
      total++
      if (f.type !== 'file' || (f.url ?? '').includes('.blob.vercel-storage.com')) { out[col].push(f); skipped++; continue }
      if (DRY) { out[col].push(f); moved++; continue }
      try {
        page ??= await notion.pages.retrieve({ page_id: r.notion_page_id })
        const fresh = (page.properties[prop]?.files ?? []).find((x) => x.name === f.name)
        const url = fresh?.file?.url ?? f.url
        const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status)
        const buf = Buffer.from(await res.arrayBuffer())
        const safe = (f.name || 'file').replace(/[^\w.\-一-鿿]+/g, '_')
        const blob = await put(`tickets/RMA-${r.number}/${col === 'files_after' ? 'after' : 'customer'}/${safe}`, buf, { access: 'public', contentType: res.headers.get('content-type') ?? undefined, addRandomSuffix: true })
        out[col].push({ name: f.name, type: 'blob', url: blob.url, size: buf.length })
        moved++
      } catch (e) { failed++; out[col].push({ ...f, migrateError: String(e.message).slice(0, 100) }) }
    }
  }
  if (!DRY) await sql`update tickets set files_after = ${sql.json(out.files_after)}, files_customer = ${sql.json(out.files_customer)} where notion_page_id = ${r.notion_page_id}`
}
console.log(`${DRY ? '[dry-run] ' : ''}工單 ${rows.length} 張有檔案；檔案 ${total} 個：搬移 ${moved}、跳過 ${skipped}、失敗 ${failed}`)
await sql.end()
