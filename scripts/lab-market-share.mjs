/**
 * 牙體技術所市佔率分析（唯讀，不寫入任何資料）
 *
 *   node scripts/lab-market-share.mjs            # 北部
 *   node scripts/lab-market-share.mjs --all      # 全台
 *   node scripts/lab-market-share.mjs --csv      # 另輸出候選名單 CSV 到 tmp/
 *
 * 分母＝BAS 開業牙技所（data/clinic-snapshot.json，kind=牙體技術所）
 * 分子＝客戶庫 客戶類型=牙體技術所，**以機構代碼對齊 BAS**（唯一可靠的 1:1 依據）
 *
 * 注意：客戶庫存在已知的重複建檔（見根目錄 可刪清單-牙體技術所重複建檔.csv），
 * 故一律以「不重複的機構代碼數」當分子，未帶機構代碼者另行統計，不計入市佔率。
 */
import { Client } from '@notionhq/client'
import fs from 'fs'
import path from 'path'

const ALL = process.argv.includes('--all')
const CSV = process.argv.includes('--csv')
const NORTH = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣']
const CITIES = ['基隆市','台北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','台中市','彰化縣','南投縣',
  '雲林縣','嘉義市','嘉義縣','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣']
const INACTIVE = ['停業', '已歇業', '撤銷']

/** BAS 用「臺」、客戶庫用「台」，一律正規化為「台」後再比對 */
const norm = (s) => (s ?? '').replace(/臺/g, '台').trim()

function loadEnv() {
  const out = {}
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      if (!(k in out)) out[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}
const env = { ...loadEnv(), ...process.env }
const notion = new Client({ auth: env.NOTION_TOKEN })
const CUSTOMERS = env.NOTION_CUSTOMERS_DB

// ── 1. BAS 市場面（分母）──
const snap = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'clinic-snapshot.json'), 'utf8'))
const basLabs = new Map()   // code -> {city, district, name}
for (const [code, item] of Object.entries(snap.codes ?? {})) {
  if (item.kind !== '牙體技術所') continue
  if (INACTIVE.includes(item.status)) continue
  const addr = norm(item.address ?? '')
  const city = CITIES.find(c => addr.startsWith(c)) ?? ''
  const district = city ? (addr.slice(city.length).match(/^(.+?[區鄉鎮市])/)?.[1] ?? '') : ''
  basLabs.set(code, { city, district, name: item.name ?? '' })
}

// ── 2. 客戶庫（分子）──
async function queryAll(db, filter) {
  const out = []
  let cursor
  do {
    const r = await notion.databases.query({ database_id: db, filter, start_cursor: cursor, page_size: 100 })
    out.push(...r.results)
    cursor = r.next_cursor
  } while (cursor)
  return out
}
const sel = (p, n) => p.properties?.[n]?.select?.name ?? ''
const txt = (p, n) => p.properties?.[n]?.rich_text?.[0]?.plain_text ?? ''
const num = (p, n) => p.properties?.[n]?.number ?? 0
const ttl = (p) => Object.values(p.properties).find(x => x?.type === 'title')?.title?.[0]?.plain_text ?? '(無名)'

// 規模一律用「牙體技術師數＋牙體技術生數」總人頭。
// 2026-09-16 實測：北部 542 家中 221 家技師數登記為 0，其中 217 家有 1–2 名技術生
//（小所多只登記技術生，負責人本人未列入）。只看技師數會把這 221 家誤判為無人小所。

const pages = await queryAll(CUSTOMERS, { property: '客戶類型', select: { equals: '牙體技術所' } })

const owner = new Map()     // BAS code -> 負責業務（多筆重複時取第一個具名者）
const dupCount = new Map()  // BAS code -> 客戶庫筆數
let noCode = 0, codeNotInBas = 0
const noCodeRows = []

for (const p of pages) {
  if (INACTIVE.includes(sel(p, '機構狀態'))) continue
  const code = txt(p, '機構代碼').trim()
  const sp = (sel(p, '負責業務') || '').trim()
  const row = {
    name: ttl(p), city: norm(sel(p, '縣市')),
    district: norm(sel(p, '行政區') || txt(p, '行政區')),
    sp, stage: sel(p, '開發階段'),
    tech: num(p, '牙體技術師數'), trainee: num(p, '牙體技術生數'),
    head: num(p, '牙體技術師數') + num(p, '牙體技術生數'),
    phone: p.properties?.['電話']?.phone_number ?? txt(p, '電話'),
    url: p.url,
  }
  if (!code) { noCode++; noCodeRows.push(row); continue }
  if (!basLabs.has(code)) { codeNotInBas++; continue }
  dupCount.set(code, (dupCount.get(code) ?? 0) + 1)
  const prev = owner.get(code)
  // 具名業務優先於 公司/盤商/空白；已有具名者不覆蓋
  const rank = (s) => !s ? 0 : (s === '公司' || s === '盤商') ? 1 : 2
  if (!prev || rank(sp) > rank(prev.sp)) owner.set(code, row)
}

// ── 3. 彙總 ──
const cityList = ALL ? CITIES : NORTH
const agg = new Map()   // city -> {market, covered, named, company, dealer, blank}
const aggD = new Map()  // city|district -> 同上
const blank = [], company = [], uncovered = []

const bump = (m, k, f) => { if (!m.has(k)) m.set(k, { market: 0, covered: 0, named: 0, company: 0, dealer: 0, blank: 0 }); m.get(k)[f]++ }

for (const [code, bas] of basLabs) {
  if (!bas.city) continue
  const dk = `${bas.city}|${bas.district}`
  bump(agg, bas.city, 'market'); bump(aggD, dk, 'market')
  const o = owner.get(code)
  if (!o) { uncovered.push({ code, ...bas }); continue }
  bump(agg, bas.city, 'covered'); bump(aggD, dk, 'covered')
  const f = !o.sp ? 'blank' : o.sp === '公司' ? 'company' : o.sp === '盤商' ? 'dealer' : 'named'
  bump(agg, bas.city, f); bump(aggD, dk, f)
  if (f === 'blank') blank.push({ code, ...bas, ...o })
  if (f === 'company') company.push({ code, ...bas, ...o })
}

// ── 4. 輸出 ──
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—'
console.log('=== 唯讀分析，未寫入任何資料 ===')
console.log(`BAS ${snap.month}　開業牙技所 ${basLabs.size} 家（全台，已排除停業/歇業/撤銷）`)
console.log(`客戶庫 客戶類型=牙體技術所 ${pages.length} 筆`)
console.log(`  其中 無機構代碼：${noCode} 筆（無法對齊 BAS，不計入市佔率）`)
console.log(`       有代碼但不在 BAS 開業名單：${codeNotInBas} 筆`)
const dups = [...dupCount.values()].filter(v => v > 1).length
console.log(`  重複建檔：${dups} 個機構代碼對到 2 筆以上客戶紀錄`)

console.log(`\n=== 縣市市佔率（${ALL ? '全台' : '北部'}；分母＝BAS 開業家數，分子＝已建檔且代碼對得上）===`)
console.log('  縣市      BAS  已覆蓋   市佔率 │ 具名  公司  盤商  未認領 │ 完全未建檔')
let T = { market: 0, covered: 0, named: 0, company: 0, dealer: 0, blank: 0 }
for (const c of cityList) {
  const a = agg.get(c); if (!a) continue
  for (const k of Object.keys(T)) T[k] += a[k]
  console.log(`  ${c.padEnd(6)} ${String(a.market).padStart(5)} ${String(a.covered).padStart(6)} ${pct(a.covered, a.market).padStart(8)} │ ${String(a.named).padStart(4)} ${String(a.company).padStart(5)} ${String(a.dealer).padStart(5)} ${String(a.blank).padStart(6)} │ ${String(a.market - a.covered).padStart(8)}`)
}
console.log(`  ${'合計'.padEnd(6)} ${String(T.market).padStart(5)} ${String(T.covered).padStart(6)} ${pct(T.covered, T.market).padStart(8)} │ ${String(T.named).padStart(4)} ${String(T.company).padStart(5)} ${String(T.dealer).padStart(5)} ${String(T.blank).padStart(6)} │ ${String(T.market - T.covered).padStart(8)}`)

console.log(`\n=== 行政區：BAS ≥ 5 家且「具名業務覆蓋率」最低的 20 區 ===`)
console.log('  縣市 行政區      BAS  具名  具名覆蓋 │ 公司  未認領  未建檔  可開發合計')
const rows = []
for (const [k, a] of aggD) {
  const [city, district] = k.split('|')
  if (!cityList.includes(city) || a.market < 5) continue
  const openable = a.blank + a.company + (a.market - a.covered)
  rows.push({ city, district, ...a, namedShare: a.named / a.market, openable })
}
rows.sort((x, y) => x.namedShare - y.namedShare || y.openable - x.openable)
rows.slice(0, 20).forEach(r => console.log(
  `  ${r.city.padEnd(4)} ${r.district.padEnd(7)} ${String(r.market).padStart(4)} ${String(r.named).padStart(5)} ${pct(r.named, r.market).padStart(8)} │ ${String(r.company).padStart(4)} ${String(r.blank).padStart(6)} ${String(r.market - r.covered).padStart(6)} ${String(r.openable).padStart(9)}`))

const inList = (r) => cityList.includes(r.city)
const b = blank.filter(inList), co = company.filter(inList), un = uncovered.filter(inList)
console.log(`\n=== 新人可承接的三個池（${ALL ? '全台' : '北部'}）===`)
const tally = (arr) => { const o = {}; arr.forEach(r => o[r.city] = (o[r.city] ?? 0) + 1); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') }
console.log(`  A 已建檔・未認領 ：${b.length} 家　${tally(b)}`)
console.log(`  B 公司持有（釋出候選）：${co.length} 家　${tally(co)}`)
console.log(`  C 完全未建檔（純陌生）：${un.length} 家　${tally(un)}`)
console.log(`  合計可開發：${b.length + co.length + un.length} 家`)

// ── 規模分級：可開發池依總人頭排序，決定新人的拜訪優先序 ──
const openable = [...b, ...co].filter(r => typeof r.head === 'number')
const band = (h) => h >= 10 ? '10人以上' : h >= 5 ? '5-9人' : h >= 3 ? '3-4人' : h >= 1 ? '1-2人' : '0人'
const bands = ['10人以上', '5-9人', '3-4人', '1-2人']
const dist = {}
openable.forEach(r => { dist[band(r.head)] = (dist[band(r.head)] ?? 0) + 1 })
console.log(`\n=== 可開發池 ${openable.length} 家的規模（師＋生總人頭）===`)
bands.forEach(x => console.log(`  ${x.padEnd(9)}${String(dist[x] ?? 0).padStart(5)} 家`))
const worth = openable.filter(r => r.head >= 3).sort((x, y) => y.head - x.head)
console.log(`\n=== 值得優先排行程：總人頭 ≥3 的 ${worth.length} 家 ===`)
worth.forEach(r => console.log(
  `  ${r.city.padEnd(4)}${(r.district || '').padEnd(7)}${r.name.slice(0, 17).padEnd(19)}` +
  `師${String(r.tech).padStart(3)}+生${String(r.trainee).padStart(2)}=${String(r.head).padStart(3)}人  ` +
  `${r.sp || '未認領'}  ${r.phone}`))

if (CSV) {
  fs.mkdirSync('tmp', { recursive: true })
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const w = (file, arr, cols) => {
    fs.writeFileSync(`tmp/${file}`, '﻿' + [cols.join(','), ...arr.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'))
    console.log(`  → tmp/${file}（${arr.length} 筆）`)
  }
  console.log('\n=== CSV 輸出 ===')
  const cols = ['code', 'name', 'city', 'district', 'tech', 'trainee', 'head', 'phone', 'stage', 'url']
  w('北部-未認領牙技所.csv', [...b].sort((x, y) => y.head - x.head), cols)
  w('北部-公司持有牙技所.csv', [...co].sort((x, y) => y.head - x.head), cols)
  w('北部-優先開發_總人頭3以上.csv', worth, cols)
  w('北部-完全未建檔牙技所.csv', un, ['code', 'name', 'city', 'district'])
}
console.log('\n（未寫入任何資料）')
