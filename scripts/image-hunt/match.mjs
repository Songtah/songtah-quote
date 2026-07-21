// 產品圖片獵取:第三步 — 目標 × 品牌索引 模糊比對,下載候選圖到工作區
// 用法:node scripts/image-hunt/match.mjs <brandKey> [--limit N] [--min-score 0.5]
// 輸出:工作區/candidates/<targetId>/cand-N.jpg + meta.json(來源頁、比對分數)

import fs from 'fs'
import path from 'path'
import { extractAttrs } from './attrs.mjs'

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

// brandKey → targets.json 中的品牌名
const BRAND_NAME = {
  zirkonzahn: 'Zirkonzahn',
  yamahachi: 'YAMAHACHI',
  schottlander: 'Davis Schottlander',
  gc: 'GC / 台灣而至',
  denken: 'DENKEN',
  songyoung: 'Song Young',
  besmile: '貝施美',
  yamakin: 'YAMAKIN',
  whipmix: 'WHIP MIX',
  mestra: 'MESTRA',
  detax: 'DETAX',
  keystone: 'KEYSTONE',
  dekema: 'Dekema',
  saeyang: 'SAEYANG',
  asiga: 'ASIGA',
  ugin: 'UGin Dental',
  cadstar: 'CADstar',
}

const brandKey = process.argv[2]
const limit = Number((process.argv.find((a) => a.startsWith('--limit')) || '').split('=')[1] || 0)
// 門檻由 0.35 提高到 0.5(2026-07-21 使用者反饋:太多同品牌內誤配,如牙托粉配到陶瓷方塊、桌燈配到頭戴放大鏡)
const minScore = Number((process.argv.find((a) => a.startsWith('--min-score')) || '').split('=')[1] || 0.5)
// --target-id=<id>:只重比對單一目標(覆核頁「重新搜尋」用),跳過整品牌清單節省時間
const targetIdFilter = (process.argv.find((a) => a.startsWith('--target-id=')) || '').split('=').slice(1).join('=')
// --target-brand:比對用的 targets.json 品牌名覆寫(索引仍用 brandKey 對應的官網爬取結果)。
// 用於兩家公司合併/共用官網的情況,如 HIGH DENTAL JAPAN 併入 DENKEN,官網索引共用但 targets 品牌名不同。
const targetBrandOverride = (process.argv.find((a) => a.startsWith('--target-brand=')) || '').split('=').slice(1).join('=')
const brandName = targetBrandOverride || BRAND_NAME[brandKey]
if (!brandName) { console.error('未知品牌,可用:', Object.keys(BRAND_NAME).join(', ')); process.exit(1) }

const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))
const index = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'brand-index', `${brandKey}.json`), 'utf8'))

// 詞袋:目標用英文 hints+品名英文詞;頁面用標題詞
const tokenize = (s) => (s.toLowerCase().match(/[a-z][a-z0-9+']{1,}/g) || []).filter((w) => !STOP.has(w))
// 2026-07-21 擴充:原本清單太短,常見但不具區辨力的通用詞(box/tool/led/kit…)在同品牌內到處出現,
// 造成完全不同類別的產品(牙托粉↔陶瓷方塊、桌燈↔頭戴放大鏡)只因共用這些字就被配對成候選
const STOP = new Set([
  'the', 'and', 'for', 'with', 'set', 'type', 'new', 'dental', 'products', 'product', 'inc', 'ltd', 'co',
  'box', 'tool', 'tools', 'holder', 'system', 'led', 'kit', 'line', 'series', 'classic', 'style',
  'design', 'group', 'item', 'accessory', 'accessories', 'part', 'parts', 'pro', 'plus', 'mini', 'max',
])
// 品牌名本身(如「GC」「YAMAKIN」)一定會同時出現在目標與該品牌自家每一頁,比對它等於白送分數、
// 完全不具區辨力(2026-07-21 實測:GC OSTRON 牙托粉單靠「gc」一詞就跟 Initial 陶瓷方塊配到 0.5 分)。
// 依實際比對品牌動態排除,而非寫死在通用 STOP 裡。
for (const w of (brandName.toLowerCase().match(/[a-z][a-z0-9+']{1,}/g) || [])) STOP.add(w)

// translatedTitle:部分品牌(如日文站 YAMAHACHI)官網標題非英文,由人工解碼補上英文對照,比對優先用它
const pageTokens = index.pages.map((p) => ({ ...p, tokens: new Set(tokenize(p.translatedTitle || p.title)) }))

function score(target, page) {
  const tks = new Set([...(target.hints || []).flatMap(tokenize), ...tokenize(target.name)])
  if (!tks.size || !page.tokens.size) return 0
  let hit = 0
  for (const t of tks) {
    if (page.tokens.has(t)) hit++
    // 模糊子字串比對加分由 0.5 降到 0.25:降低單靠部分字元重疊就衝高分數的誤配風險
    else if ([...page.tokens].some((pt) => pt.length > 4 && (pt.includes(t) || t.includes(pt)))) hit += 0.25
  }
  const base = hit / tks.size // 目標詞的命中率(頁面多餘的詞不扣分:官網標題常帶副標)

  // 顏色/牙色與容量、重量比對加分:目標名稱中的色號/尺寸若也出現在候選頁標題,精準度訊號更強
  // (build-targets.mjs 已用 attrs.mjs 抽好;若是舊 targets.json 未帶 attrs 則即時抽一次,向下相容)
  const attrs = target.attrs || extractAttrs(target.name)
  const pageTitle = (page.translatedTitle || page.title || '').toLowerCase()
  let bonus = 0
  for (const c of attrs.colors || []) if (pageTitle.includes(c.toLowerCase())) bonus += 0.08
  for (const s of attrs.sizes || []) if (pageTitle.includes(s.toLowerCase())) bonus += 0.12

  return base + Math.min(bonus, 0.3)
}

async function download(url, dest, referer) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 3000) throw new Error('過小,疑為 icon')
  fs.writeFileSync(dest, buf)
  return buf.length
}

// 已經人工選過圖的目標一律跳過重比對:candidates/<id>/cand-N.xxx 檔名是每次重跑從 1 開始重新編號,
// 若重新產生的候選圖跟之前不同,同名檔案會被覆蓋掉不同內容,decisions.json 記的還是舊檔名 →
// 使用者已選好的圖會在背後被悄悄換掉(apply.mjs 讀的是本機檔案,不是重新下載 imageUrl)。
// 2026-07-21 全量重跑前修:已選圖(有 file)的目標永遠不重新產生候選,保護既有進度。
let decidedWithFile = new Set()
try {
  const decisions = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'decisions.json'), 'utf8'))
  decidedWithFile = new Set(Object.entries(decisions).filter(([, d]) => d.picks && d.picks.length).map(([id]) => id))
} catch {}

async function main() {
  let list = targets.filter((t) => t.brand === brandName)
  if (targetIdFilter) list = list.filter((t) => t.id === targetIdFilter)
  else if (limit) list = list.slice(0, limit)
  const skippedDecided = list.filter((t) => decidedWithFile.has(t.id)).length
  list = list.filter((t) => !decidedWithFile.has(t.id))
  console.log(`${brandName}:${list.length} 個目標 × ${pageTokens.length} 個官網頁面(已選圖略過 ${skippedDecided} 個,保護既有進度)`)
  let hitCount = 0
  for (const t of list) {
    let ranked = pageTokens
      .map((p) => ({ p, s: score(t, p) }))
      .filter((r) => r.s >= minScore)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
    // 母子頁互斥:同時命中「總覽頁」與其底下的「個別規格頁」時,只留子頁——
    // 總覽頁(如 zirkonzahn colour-liquid)常一頁塞多種變體縮圖,分數只要跟品牌+大類同字就能命中任何一個
    // 變體目標,結果把 A 變體的圖錯配給 B 變體(2026-07-21 使用者回報實例)。子頁網址是總覽頁的子路徑、
    // 標題通常更貼近目標,優先度應該更高。
    const urls = ranked.map((r) => r.p.url)
    ranked = ranked.filter((r) => !urls.some((u) => u !== r.p.url && u.startsWith(r.p.url + '/'))).slice(0, 3)
    if (!ranked.length) continue
    const dir = path.join(WORKSPACE, 'candidates', t.id.replace(/[:\/]/g, '_'))
    fs.mkdirSync(dir, { recursive: true })
    const meta = { target: t, candidates: [] }
    let n = 0
    for (const { p, s } of ranked) {
      for (const img of p.images.slice(0, 3)) {
        if (n >= 6) break
        const file = `cand-${++n}${path.extname(new URL(img).pathname) || '.jpg'}`
        try {
          const size = await download(img, path.join(dir, file), p.url)
          meta.candidates.push({ file, imageUrl: img, pageUrl: p.url, pageTitle: p.translatedTitle ? `${p.translatedTitle}(${p.title})` : p.title, score: Number(s.toFixed(2)), bytes: size })
        } catch { n-- }
      }
    }
    if (meta.candidates.length) {
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1))
      hitCount++
    } else fs.rmSync(dir, { recursive: true, force: true })
    await new Promise((r) => setTimeout(r, 250))
  }
  console.log(`完成:${hitCount}/${list.length} 個目標找到候選圖(門檻 ${minScore})`)
}

main()
