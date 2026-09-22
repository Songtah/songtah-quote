/**
 * 陌生開發名單 — 找出「從來沒有任何業務接觸過」的牙體技術所（唯讀，不寫入）
 *
 *   node scripts/cold-list-for-new-sales.mjs               # 北部、牙體技術所
 *   node scripts/cold-list-for-new-sales.mjs --all         # 全台
 *   node scripts/cold-list-for-new-sales.mjs --clinics     # 改看牙醫診所
 *   node scripts/cold-list-for-new-sales.mjs --csv         # 輸出 CSV 到 tmp/
 *
 * 「接觸過」的定義＝客情拜訪 DB 裡有任何一筆紀錄指向該客戶。
 * 注意：未認領 ≠ 沒接觸過。
 *   - 有負責業務但從未拜訪 → 名義上有主，不列入陌生名單（另行標示）
 *   - 未認領但曾被拜訪過   → 已經接觸過，也不算陌生
 */
import { Client } from '@notionhq/client'
import fs from 'fs'
import path from 'path'

const ALL = process.argv.includes('--all')
const CLINICS = process.argv.includes('--clinics')
const CSV = process.argv.includes('--csv')
const TYPE = CLINICS ? '牙醫診所' : '牙體技術所'
const BAS_KIND = CLINICS ? '牙醫診所' : '牙體技術所'

const NORTH = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣']
const CITIES = ['基隆市','台北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','台中市','彰化縣','南投縣',
  '雲林縣','嘉義市','嘉義縣','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣']
const INACTIVE = ['停業', '已歇業', '撤銷']
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
const VISITS = env.NOTION_VISITS_DB || '285dcdaafb2a80aea173db268665ae16'

async function queryAll(db, filter) {
  const out = []
  let cursor
  do {
    const r = await notion.databases.query({ database_id: db, ...(filter ? { filter } : {}), start_cursor: cursor, page_size: 100 })
    out.push(...r.results)
    cursor = r.next_cursor
  } while (cursor)
  return out
}

// ── 1. 拜訪紀錄：建立「被接觸過」的客戶集合 ──
const visits = await queryAll(VISITS)
if (visits.length >= 9900) {
  console.error('⚠ 拜訪筆數接近 10,000，Notion 無過濾分頁會靜默截斷，需改分區掃描後再跑。')
  process.exit(1)
}
const touched = new Map()      // customer page id -> {count, last, sales:Set}
const touchedNames = new Set() // 無 relation 時的手打單位名稱
for (const v of visits) {
  const rel = v.properties?.['🏥 牙科單位資料']?.relation ?? []
  const date = v.properties?.['日期']?.date?.start ?? ''
  const sp = v.properties?.['業務人員']?.select?.name
    ?? v.properties?.['業務人員']?.rich_text?.[0]?.plain_text ?? ''
  if (rel.length === 0) {
    const nm = v.properties?.['單位名稱']?.title?.[0]?.plain_text ?? ''
    if (nm) touchedNames.add(nm.trim())
    continue
  }
  for (const r of rel) {
    if (!touched.has(r.id)) touched.set(r.id, { count: 0, last: '', sales: new Set() })
    const t = touched.get(r.id)
    t.count++
    if (date > t.last) t.last = date
    if (sp) t.sales.add(sp)
  }
}

// ── 2. BAS 市場面（判斷是否為開業登記機構）──
const snap = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'clinic-snapshot.json'), 'utf8'))
const bas = new Map()
for (const [code, item] of Object.entries(snap.codes ?? {})) {
  if (item.kind !== BAS_KIND || INACTIVE.includes(item.status)) continue
  const a = norm(item.address ?? '')
  const city = CITIES.find(c => a.startsWith(c)) ?? ''
  bas.set(code, { city, district: city ? (a.slice(city.length).match(/^(.+?[區鄉鎮市])/)?.[1] ?? '') : '' })
}

// ── 3. 客戶庫 ──
const sel = (p, n) => p.properties?.[n]?.select?.name ?? ''
const txt = (p, n) => p.properties?.[n]?.rich_text?.[0]?.plain_text ?? ''
const num = (p, n) => p.properties?.[n]?.number ?? 0
const ttl = (p) => p.properties?.['客戶名稱']?.title?.[0]?.plain_text ?? '(無名)'

const pages = await queryAll(CUSTOMERS, { property: '客戶類型', select: { equals: TYPE } })
const cityList = ALL ? CITIES : NORTH

const rows = []
for (const p of pages) {
  if (INACTIVE.includes(sel(p, '機構狀態'))) continue
  const code = txt(p, '機構代碼').trim()
  const b = bas.get(code)
  if (!b || !cityList.includes(b.city)) continue
  const t = touched.get(p.id)
  const nameHit = touchedNames.has(ttl(p).trim())   // 手打名稱也算接觸過
  rows.push({
    code, name: ttl(p), city: b.city, district: b.district,
    sp: (sel(p, '負責業務') || '').trim(),
    visits: t?.count ?? 0,
    lastVisit: t?.last ?? '',
    visitedBy: t ? [...t.sales].join('/') : (nameHit ? '(僅手打名稱)' : ''),
    everTouched: !!t || nameHit,
    tech: num(p, '牙體技術師數'), trainee: num(p, '牙體技術生數'),
    head: num(p, '牙體技術師數') + num(p, '牙體技術生數'),
    phone: p.properties?.['電話']?.phone_number ?? txt(p, '電話'),
    address: txt(p, '地址'),
    url: p.url,
  })
}

// ── 4. 分類 ──
const cold = rows.filter(r => !r.everTouched && (!r.sp || r.sp === '公司'))   // 真陌生，可直接給新人
const ownedUntouched = rows.filter(r => !r.everTouched && r.sp && r.sp !== '公司' && r.sp !== '盤商')
const touchedUnclaimed = rows.filter(r => r.everTouched && !r.sp)
const warm = rows.filter(r => r.everTouched)

const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—'
console.log('=== 唯讀分析，未寫入任何資料 ===')
console.log(`拜訪紀錄 ${visits.length} 筆；其中有客戶 relation 者涵蓋 ${touched.size} 家客戶`)
console.log(`（另有 ${touchedNames.size} 個只有手打單位名稱、無 relation 的拜訪對象，已一併視為接觸過）`)
console.log(`\n${ALL ? '全台' : '北部'}・${TYPE}（代碼對得上 BAS 開業名單）共 ${rows.length} 家`)
console.log(`  曾被拜訪過          ：${warm.length}  ${pct(warm.length, rows.length)}`)
console.log(`  從未被拜訪過        ：${rows.length - warm.length}  ${pct(rows.length - warm.length, rows.length)}`)
console.log(`    ├ 無主（可給新人）：${cold.length}`)
console.log(`    └ 已有負責業務    ：${ownedUntouched.length}  ← 名義上有主，不列入陌生名單`)
console.log(`  未認領但曾被拜訪    ：${touchedUnclaimed.length}  ← 有人跑過，不算陌生`)

const byCity = (arr) => { const o = {}; arr.forEach(r => o[r.city] = (o[r.city] ?? 0) + 1); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') }
console.log(`\n=== 陌生名單 ${cold.length} 家：縣市分布 ===\n  ${byCity(cold)}`)

const band = (h) => h >= 10 ? '10人以上' : h >= 5 ? '5-9人' : h >= 3 ? '3-4人' : h >= 1 ? '1-2人' : '0人'
if (!CLINICS) {
  const d = {}; cold.forEach(r => d[band(r.head)] = (d[band(r.head)] ?? 0) + 1)
  console.log(`\n=== 陌生名單規模（師＋生總人頭）===`)
  ;['10人以上', '5-9人', '3-4人', '1-2人'].forEach(x => console.log(`  ${x.padEnd(9)}${String(d[x] ?? 0).padStart(5)} 家`))
  const top = cold.filter(r => r.head >= 3).sort((a, b) => b.head - a.head)
  console.log(`\n=== 陌生名單中總人頭 ≥3 的 ${top.length} 家（優先拜訪）===`)
  top.forEach(r => console.log(
    `  ${r.city.padEnd(4)}${(r.district || '').padEnd(7)}${r.name.slice(0, 17).padEnd(19)}` +
    `師${String(r.tech).padStart(3)}+生${String(r.trainee).padStart(2)}=${String(r.head).padStart(3)}人  ` +
    `${r.sp || '未認領'}  ${r.phone}`))
}

console.log(`\n=== 參考：已有負責業務但從未拜訪的 ${ownedUntouched.length} 家（各業務的空窗）===`)
const bySp = {}; ownedUntouched.forEach(r => bySp[r.sp] = (bySp[r.sp] ?? 0) + 1)
Object.entries(bySp).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(10)}${String(v).padStart(4)} 家`))

if (CSV) {
  fs.mkdirSync('tmp', { recursive: true })
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const cols = ['code', 'name', 'city', 'district', 'tech', 'trainee', 'head', 'phone', 'address', 'sp', 'url']
  const w = (f, arr) => {
    fs.writeFileSync(`tmp/${f}`, '﻿' + [cols.join(','), ...arr.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'))
    console.log(`  → tmp/${f}（${arr.length} 筆）`)
  }
  const tag = ALL ? '全台' : '北部'
  console.log('\n=== CSV 輸出 ===')
  w(`${tag}-${TYPE}-陌生名單_從未拜訪且無主.csv`, [...cold].sort((a, b) => b.head - a.head))
  w(`${tag}-${TYPE}-已有主但從未拜訪.csv`, [...ownedUntouched].sort((a, b) => b.head - a.head))
}
console.log('\n（未寫入任何資料）')
