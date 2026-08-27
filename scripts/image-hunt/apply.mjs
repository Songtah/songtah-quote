// 產品圖片獵取:第五步 — 把覆核通過的圖寫入系統(dry-run 預設)
// 用法:node scripts/image-hunt/apply.mjs [--write]
// 動作:
//   1. 讀 decisions.json(只處理已選圖、未 skip、未套用的)
//   2. sharp 轉 webp(最長邊 1200)+ 內容雜湊檔名 + dHash 感知去重(同圖共用同一 Blob URL)
//   3. group 目標 → image-index.json 為每個 memberCode 寫同一 URL(只補空白,不覆蓋既有圖)
//      series 目標 → Notion 系列庫 主圖URL(僅在原本為空時寫入)
//   4. 已套用記到 applied.json,可重跑不重複
//
// 2026-07-21 決策改複選(picks 陣列,可選主圖+hover 替換圖)後的權宜作法:
// 這裡只取 picks[0](主圖)寫入,維持跟現有 image-index.json/Notion 主圖URL 完全相同的單張圖 schema——
// 兩者都是正式系統目前在用的 live 資料(image-index.json 經 lib/products-notion.ts 快取、Redis 版本控管),
// 改成陣列會動到消費端與快取邏輯,是另一個獨立、需要另外確認的改動,不在這支腳本裡順手做。
// picks[1]以後(hover 替換圖)目前只留在 decisions.json 裡,尚未接到任何正式頁面。
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { put, list } from '@vercel/blob'
import { Client } from '@notionhq/client'

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const WRITE = process.argv.includes('--write')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const SERIES_DB = process.env.NOTION_SERIES_DB

const decisions = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'decisions.json'), 'utf8'))
const appliedPath = path.join(WORKSPACE, 'applied.json')
const applied = fs.existsSync(appliedPath) ? JSON.parse(fs.readFileSync(appliedPath, 'utf8')) : {}
const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))
const targetById = new Map(targets.map((t) => [t.id, t]))

// dHash(9x8 灰階,64-bit)供感知去重
async function dHash(buf) {
  const raw = await sharp(buf).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] < raw[y * 9 + x + 1] ? '1' : '0'
  return bits
}
const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d }

async function loadImageIndex() {
  const res = await list({ prefix: 'products/catalog/image-index.json' })
  if (!res.blobs.length) return { images: {} }
  return await (await fetch(res.blobs[0].url)).json()
}

async function main() {
  const picks = Object.entries(decisions).filter(([id, d]) => !d.skip && d.picks?.length && !applied[id])
  console.log(`${WRITE ? '【寫入模式】' : '【dry-run】'} 待套用 ${picks.length} 筆(已 skip ${Object.values(decisions).filter((d) => d.skip).length}、已套用 ${Object.keys(applied).length})`)
  if (!picks.length) return

  const index = await loadImageIndex()
  const uploaded = [] // {hash, dhash, url}
  let skuWrites = 0, seriesWrites = 0, skippedExisting = 0

  for (const [id, decision] of picks) {
    const t = targetById.get(id)
    if (!t) { console.log(`! ${id} 不在 targets.json,跳過`); continue }
    const d = decision.picks[0] // 主圖(picks[0]);hover 替換圖(picks[1]+)暫不接消費端,見檔頭說明
    const buf = fs.readFileSync(path.join(WORKSPACE, 'candidates', d.dir, d.file))
    const webp = await sharp(buf).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer()
    const hash = crypto.createHash('sha256').update(webp).digest('hex')
    const dh = await dHash(webp)

    // 去重:內容相同或感知距離 ≤6 → 共用既有 URL
    let url = uploaded.find((u) => u.hash === hash || hamming(u.dhash, dh) <= 6)?.url
    if (!url) {
      if (WRITE) {
        const blob = await put(`products/catalog/${hash}.webp`, webp, { access: 'public', contentType: 'image/webp', addRandomSuffix: false, allowOverwrite: true })
        url = blob.url
      } else url = `(dry-run) products/catalog/${hash}.webp`
      uploaded.push({ hash, dhash: dh, url })
    }

    if (t.kind === 'group') {
      for (const code of t.memberCodes) {
        if (index.images[code]) { skippedExisting++; continue } // 只補空白
        index.images[code] = url
        skuWrites++
      }
    } else if (t.kind === 'series') {
      if (WRITE) {
        const q = await notion.databases.query({ database_id: SERIES_DB, filter: { property: '系列代碼', rich_text: { equals: t.code } }, page_size: 1 })
        const page = q.results[0]
        const existing = page?.properties?.['主圖URL']?.url
        if (existing) { skippedExisting++; }
        else if (page) { await notion.pages.update({ page_id: page.id, properties: { 主圖URL: { url } } }); seriesWrites++ }
        else {
          await notion.pages.create({ parent: { database_id: SERIES_DB }, properties: {
            系列名稱: { title: [{ text: { content: t.name } }] },
            系列代碼: { rich_text: [{ text: { content: t.code } }] },
            ...(t.brand ? { 品牌: { select: { name: t.brand } } } : {}),
            主圖URL: { url },
          } })
          seriesWrites++
        }
      } else seriesWrites++
    }
    applied[id] = { url, at: new Date().toISOString(), dryRun: !WRITE }
    console.log(`✓ ${t.kind === 'series' ? '系列' : '組'} ${t.code}「${t.name}」→ ${url.slice(0, 90)}`)
  }

  if (WRITE) {
    await put('products/catalog/image-index.json', Buffer.from(JSON.stringify({ version: new Date().toISOString(), images: index.images })), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true })
    fs.writeFileSync(appliedPath, JSON.stringify(applied, null, 1))
  }
  console.log(`合計:SKU 索引 +${skuWrites}、系列封面 +${seriesWrites}、略過已有圖 ${skippedExisting}、上傳圖檔 ${uploaded.length} 張(去重後)`)
  if (!WRITE) console.log('確認無誤後加 --write 真正寫入')
}

main()
