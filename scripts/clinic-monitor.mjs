/**
 * scripts/clinic-monitor.mjs
 *
 * 每月比對全國牙科機構開業/停業，更新快照 data/clinic-snapshot.json 並寫入 Notion。
 *
 * ── 資料來源：衛福部醫事查詢系統（BAS, ma.mohw.gov.tw）─────────────────────────
 *   BAS_KIND=A + DEP_DEPT_ID=51（牙醫一般科）→ 牙科醫療機構（診所/醫院/衛生所）
 *   BAS_KIND=2                               → 牙體技術所
 *   BAS_KIND=L                               → 鑲牙所
 *   詳細頁 BASBasicData 給「機構代碼 + 開業狀態」。
 *   CAPTCHA 答案直接放在首頁 img[data-code]，可直接讀取。
 *
 * ── 不失敗設計（最重要）──────────────────────────────────────────────────────
 *   BAS 有 WAF/限流，全台 ~1 萬筆詳細頁無法一次抓完。故採「持久代碼快取 + 增量 +
 *   帶走舊值 + 永不拋錯」：
 *     - data/bas-cache.json：basSeq__zoneSeq → { code, status, name, address, kind }
 *       跨次累積，避免每月重抓；只抓本次新出現、cache 還沒有 code 的機構。
 *     - 時間預算內抓詳細頁，到點即停（其餘下次續抓）。
 *     - 任一 BAS 步驟失敗 → 沿用上月/快取資料，不丟覆蓋、不 throw。
 *     - 反覆按「更新醫事資料」即可逐步收斂到完整（cache pending=0）。
 *   → snapshot 永遠有效，GitHub Action 永遠綠燈。
 *
 * ── 異動類型（寫入 Notion）────────────────────────────────────────────────────
 *   新增停業 / 恢復開業 / 新開業 / 停業 / 查無代碼 / 月份摘要
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const NOTION_TOKEN       = process.env.NOTION_TOKEN
const CLINIC_MONITOR_DB  = process.env.NOTION_CLINIC_MONITOR_DB
const CUSTOMERS_DB       = process.env.NOTION_CUSTOMERS_SYSTEM_DB
const TREND_DB           = process.env.NOTION_MEDICAL_TREND_DB || '386dcdaa-fb2a-818f-8c11-d24e88b111b3'
const SCHOOLS_PATH       = 'data/schools.json'
const DRY_RUN            = process.env.DRY_RUN === 'true'
const SNAPSHOT_PATH      = 'data/clinic-snapshot.json'
const CACHE_PATH         = 'data/bas-cache.json'

const MOHW_SEARCH    = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/MASearchBAS'
const MOHW_RESULTS   = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BasResults'
const MOHW_DETAIL    = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData'

// 要列舉的機構類別（一個 kind 一次全台列表查詢；Accessibility 版會一次回全部，無分頁）
const KIND_CONFIGS = [
  { kind: 'A', dep: '51',   label: '牙科醫療機構' },  // 診所/醫院/衛生所（牙醫一般科）
  { kind: '2', dep: '全部', label: '牙體技術所' },
  { kind: 'L', dep: '全部', label: '鑲牙所' },
]

const TOTAL_BUDGET_MS = (+process.env.BAS_BUDGET_MIN || 20) * 60_000   // 全程時間預算（含列表+詳細）；到點即停，下次續抓
const CONCURRENCY     = 6             // 詳細頁並行數（對 WAF 禮貌）

// ── Logging ─────────────────────────────────────────────────────────────────

const log  = (...a) => console.log('[clinic-monitor]', ...a)
const warn = (...a) => console.warn('[clinic-monitor] ⚠', ...a)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── BAS helpers ───────────────────────────────────────────────────────────────

// 模擬瀏覽器的共用 headers（WAF 偵測用）
const BROWSER_HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':  'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding':  'gzip, deflate, br',
  'Connection':       'keep-alive',
  'sec-ch-ua':        '"Google Chrome";v="125", "Chromium";v="125"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

// HTML entity decode（BAS 回傳的中文常是 &#x...;（hex）或 &#...;（decimal））
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/** 取首頁 → CSRF token、CAPTCHA 答案、session cookie（單一 session 不可重用於多次列表查詢，故每查詢重取）*/
async function getSession() {
  const res = await fetch(MOHW_SEARCH, {
    headers: { ...BROWSER_HEADERS, 'Upgrade-Insecure-Requests': '1' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`MOHW 首頁 → HTTP ${res.status}`)
  const html = await res.text()
  const cookieStr = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
  const csrf  = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
                 html.match(/value="(CfDJ[^"]+)"/))?.[1]
  const vcode = html.match(/data-code="([^"]+)"/)?.[1]
  if (!csrf || !vcode) throw new Error('無法取得 CSRF token 或 CAPTCHA code（WAF 或頁面改版）')
  return { cookieStr, csrf, vcode }
}

/** POST 列表查詢（全台）→ [{ name, city, dist, basSeq, zoneSeq }]。失敗時 throw 由呼叫端決定沿用上月。*/
async function fetchList({ kind, dep, session }) {
  const params = new URLSearchParams({
    __RequestVerificationToken: session.csrf,
    BAS_KIND:       kind,
    ZONE_AREA_CODE: '全部',
    ZONE_ZIP_CODE:  '全部',
    DEP_DEPT_ID:    dep,
    BAS_NAME:       '',
    txtVCode:       session.vcode,
  })
  const res = await fetch(MOHW_RESULTS, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Cookie':         session.cookieStr,
      'Referer':        MOHW_SEARCH,
      'Origin':         'https://ma.mohw.gov.tw',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'Cache-Control':  'max-age=0',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`MOHW 列表 → HTTP ${res.status}`)
  const html = await res.text()

  const rows = []
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c =>
      decodeEntities(c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    )
    if (cells.length < 4) continue
    const name = cells[1]?.trim()
    if (!name || name === '機構名稱') continue
    const basSeq = m[1].match(/BAS_SEQ=([^&"]+)/)?.[1]
    if (!basSeq) continue
    rows.push({
      name,
      city:    cells[2]?.trim() ?? '',
      dist:    cells[3]?.trim() ?? '',
      basSeq,
      zoneSeq: m[1].match(/ZONE_SEQ=([^&"]+)/)?.[1] ?? '',
    })
  }
  return rows
}

/** 列表查詢含重試（每次重取 session）；最終仍失敗則回 null（呼叫端沿用上月）*/
async function fetchListWithRetry({ kind, dep, label }, deadline, maxRetry = 2) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    if (Date.now() > deadline) { warn(`${label} 列表：已逾時間預算，略過`); return null }
    try {
      const session = await getSession()
      const rows = await fetchList({ kind, dep, session })
      if (rows.length === 0) throw new Error('回傳 0 筆（疑似被 WAF 擋）')
      log(`  ${label}：列表 ${rows.length} 筆`)
      return { rows, session }
    } catch (e) {
      if (attempt < maxRetry) { warn(`${label} 列表第 ${attempt} 次失敗（${e.message}），5 秒後重試…`); await sleep(5_000) }
      else                    { warn(`${label} 列表最終失敗（${e.message}），將沿用上月資料`); return null }
    }
  }
  return null
}

/** 詳細頁 → { code, status }（機構代碼 + 開業狀態）*/
async function fetchDetail(basSeq, zoneSeq, cookieStr) {
  const url = `${MOHW_DETAIL}?BAS_SEQ=${basSeq}&ZONE_SEQ=${zoneSeq}`
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, 'Cookie': cookieStr, 'Referer': MOHW_RESULTS },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const html = decodeEntities(await res.text())
    const code   = html.match(/機構代碼[\s\S]{0,400}?<span[^>]*>\s*([A-Za-z0-9]{5,20})\s*<\/span>/)?.[1] ?? null
    const status = html.match(/開業狀態[\s\S]{0,200}?<span[^>]*>\s*([^<]{1,20}?)\s*<\/span>/)?.[1]?.trim() ?? ''
    if (!code) return null
    return { code, status }
  } catch {
    return null
  }
}

const isClosedStatus = (s) => /停業|歇業|撤銷|註銷|廢止/.test(s ?? '')
const isOpenStatus   = (s) => !!s && !isClosedStatus(s)

/** 由醫療機構名稱推得顯示類別（A 類列表不分診所/醫院/衛生所，由名稱判斷）*/
function classifyMedical(name) {
  if (/醫院/.test(name))   return '醫院'
  if (/衛生所/.test(name)) return '衛生所'
  return '牙醫診所'
}

// ── 崧達客戶 ───────────────────────────────────────────────────────────────────

async function fetchSongtahCustomers() {
  if (!CUSTOMERS_DB) { warn('未設定 NOTION_CUSTOMERS_SYSTEM_DB，跳過客戶比對'); return { byCode: new Map(), byName: new Map(), counts: {} } }
  log('載入崧達客戶 …')
  const byCode = new Map()
  const byName = new Map()
  const counts = { custClinics: 0, custLabs: 0, custHospitals: 0, custSchools: 0 } // 各類型數量（含無代碼）
  let cursor
  do {
    const body = { page_size: 100 }   // 不濾代碼，全部載入以統計各類型數量
    if (cursor) body.start_cursor = cursor
    const res = await notionPost(`/databases/${CUSTOMERS_DB}/query`, body)
    for (const page of res.results) {
      const name =
        page.properties['名稱']?.title?.[0]?.plain_text      ??
        page.properties['客戶名稱']?.title?.[0]?.plain_text  ??
        page.properties['Name']?.title?.[0]?.plain_text      ?? ''
      if (!name) continue
      const type = page.properties['客戶類型']?.select?.name ?? ''
      if (type === '牙醫診所' || type === '衛生所')        counts.custClinics++
      else if (type === '牙體技術所' || type === '鑲牙所') counts.custLabs++
      else if (type === '醫院')                            counts.custHospitals++
      else if (type === '學術機構')                        counts.custSchools++
      const code = getText(page, '機構代碼').trim()
      if (!code) continue
      const entry = { name, pageId: page.id, code }
      byCode.set(code, entry)
      byName.set(normalizeName(name), entry)
    }
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)
  log(`  有機構代碼的客戶：${byCode.size} 筆；類型計數 ${JSON.stringify(counts)}`)
  return { byCode, byName, counts }
}

/** 名稱正規化（去空格、去常見後綴）用於模糊比對 */
function normalizeName(name) {
  return name.replace(/\s+/g, '').replace(/有限公司|股份有限公司|診所|技術所|牙醫|牙體/g, '')
}

// ── 比對 ─────────────────────────────────────────────────────────────────────

function buildChanges({ currentData, prevCodes, customers, month }) {
  const changes = []
  if (!prevCodes) { log('第一次執行，只建快照'); return changes }
  const prevSet    = new Set(Object.keys(prevCodes))
  const currentSet = new Set(currentData.keys())

  for (const key of prevSet) {
    if (currentSet.has(key)) continue
    const prev = prevCodes[key]
    const cust = matchCustomer(customers, key, prev)
    changes.push({
      type: cust ? '新增停業' : '停業',
      month, key,
      name: prev.name, address: prev.address ?? '', specialty: prev.specialty ?? '',
      kind: prev.kind ?? '', termDate: prev.termDate ?? '', source: prev.source ?? '',
      customer: cust?.name ?? '', customerUrl: cust ? custUrl(cust.pageId) : '',
    })
  }
  for (const [key, info] of currentData) {
    if (prevSet.has(key)) continue
    const cust = matchCustomer(customers, key, info)
    changes.push({
      type: cust ? '恢復開業' : '新開業',
      month, key,
      name: info.name, address: info.address, specialty: info.specialty,
      kind: info.kind, termDate: info.termDate, source: info.source,
      customer: cust?.name ?? '', customerUrl: cust ? custUrl(cust.pageId) : '',
    })
  }
  return changes
}

function matchCustomer(customers, key, info) {
  const { byCode, byName } = customers
  if (byCode.has(key)) return byCode.get(key)
  const norm = normalizeName(info.name ?? '')
  if (norm && byName.has(norm)) return byName.get(norm)
  return null
}

function buildNotFoundList({ currentData, customers, prevCodes }) {
  if (!prevCodes) return []
  const result = []
  for (const [code, cust] of customers.byCode) {
    if (!currentData.has(code)) {
      if (code in prevCodes) continue   // 上月也查不到 → 不重複寫入
      result.push({ type: '查無代碼', code, customer: cust.name, customerUrl: custUrl(cust.pageId) })
    }
  }
  return result
}

const custUrl = id => `https://songtah-quote.vercel.app/customers/${id}`

// ── Notion ────────────────────────────────────────────────────────────────────

const DELAY_MS = 340
const richText = t => [{ type: 'text', text: { content: String(t ?? '').slice(0, 2000) } }]

async function writeRecord(rec) {
  if (DRY_RUN) { log(`  [DRY] ${rec.type} | ${rec.name || rec.customer}`); return }
  const title = {
    '新增停業': `🚨 ${rec.name}（${rec.customer}）`,
    '恢復開業': `✅ ${rec.name}（${rec.customer}）`,
    '新開業':   `🆕 ${rec.name}`,
    '停業':     `⬜ ${rec.name}`,
    '查無代碼': `🔍 ${rec.customer}（機構代碼查無）`,
    '月份摘要': rec.name,
  }[rec.type] ?? `${rec.type}｜${rec.name}`

  const props = {
    '標題':    { title:  richText(title) },
    '異動類型':{ select: { name: rec.type } },
  }
  if (rec.month)       props['月份']     = { date: { start: rec.month + '-01' } }
  if (rec.key || rec.code) props['機構代碼'] = { rich_text: richText(rec.key || rec.code || '') }
  if (rec.name)        props['健保名稱'] = { rich_text: richText(rec.name) }
  if (rec.customer)    props['客戶名稱'] = { rich_text: richText(rec.customer) }
  if (rec.address)     props['地址']     = { rich_text: richText(rec.address) }
  if (rec.specialty || rec.kind) props['診療科別'] = { rich_text: richText(rec.specialty || rec.kind) }
  if (rec.customerUrl) props['客戶頁面'] = { url: rec.customerUrl }
  if (rec.termDate && /^\d{8}$/.test(rec.termDate)) {
    const d = rec.termDate
    props['終止日期'] = { date: { start: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` } }
  }
  await notionPost('/pages', { parent: { database_id: CLINIC_MONITOR_DB }, properties: props })
  await sleep(DELAY_MS)
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Notion POST ${path} → ${res.status}: ${t.slice(0, 200)}`)
  }
  return res.json()
}

const getText = (page, f) => page.properties[f]?.rich_text?.map(t => t.plain_text).join('') ?? ''

async function notionPatch(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Notion PATCH ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** 寫入「醫事數量趨勢」DB（一月一列，依月份 upsert）。只寫有提供的數值欄（diff 指標屬比對頁，月排程留空）*/
async function upsertTrendRow(rec) {
  const props = {
    '月份':     { title: [{ text: { content: rec.month } }] },
    '紀錄時間': { date: { start: new Date().toISOString() } },
  }
  const map = {
    '全台_牙醫診所': rec.totalClinics, '全台_牙體技術所': rec.totalLabs, '全台_醫院': rec.totalHospitals, '全台_學校': rec.totalSchools,
    '客戶_牙醫診所': rec.custClinics, '客戶_牙體技術所': rec.custLabs, '客戶_醫院': rec.custHospitals, '客戶_學校': rec.custSchools,
    '客戶有代碼': rec.customerWithCode, '在BAS開業': rec.inBasOpen, '待開發': rec.toDevelop,
    '疑似歇業': rec.suspectedClosures, '醫院待確認': rec.hospitalUnverified, '更換代碼': rec.codeChanged, '資料不一致': rec.inconsistentData,
  }
  for (const [k, v] of Object.entries(map)) if (Number.isFinite(v)) props[k] = { number: v }
  const q = await notionPost(`/databases/${TREND_DB}/query`, { page_size: 1, filter: { property: '月份', title: { equals: rec.month } } })
  if (q.results?.[0]) await notionPatch(`/pages/${q.results[0].id}`, { properties: props })
  else                await notionPost('/pages', { parent: { database_id: TREND_DB }, properties: props })
}

// ── 快取 ──────────────────────────────────────────────────────────────────────

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {}
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) } catch { warn('解析 bas-cache 失敗，視為空'); return {} }
}
const cacheKeyOf = (basSeq, zoneSeq) => `${basSeq}__${zoneSeq}`

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!NOTION_TOKEN)      throw new Error('缺少 NOTION_TOKEN')
  if (!CLINIC_MONITOR_DB) throw new Error('缺少 NOTION_CLINIC_MONITOR_DB')

  const startedAt = Date.now()
  const deadline  = startedAt + TOTAL_BUDGET_MS
  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  log(`月份：${month}${DRY_RUN ? '（DRY RUN）' : ''}　來源：衛福部醫事查詢系統(BAS)`)

  // 1. 上月快照 + 持久代碼快取
  let prevSnapshot = null
  if (existsSync(SNAPSHOT_PATH)) {
    try { prevSnapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); log(`上月快照：${Object.keys(prevSnapshot.codes ?? {}).length} 筆（${prevSnapshot.month}）`) }
    catch { warn('解析 snapshot 失敗，視為首次執行') }
  } else { log('無 snapshot，首次執行') }
  // 只有「上月也是 BAS 來源」才做月對月異動比對；換來源（如舊 NHI 快照）時 diff 無意義，
  // 視為建立 BAS 基準（不寫一堆假停業/新開業到 Notion、不計增減）。
  const prevComparable = prevSnapshot?.source === 'mohw-bas' ? prevSnapshot : null
  if (prevSnapshot && !prevComparable) log('上月快照非 BAS 來源 → 本次建立 BAS 基準（不做異動比對）')
  const cache = loadCache()
  log(`代碼快取：${Object.keys(cache).length} 筆`)

  // 2. 列表階段：每類別一次全台查詢（失敗 → 沿用上月該類別）
  const lists = {}                 // kind label → { rows[], session }
  const kindStale = {}             // label → true 表示本次列表失敗、沿用上月
  for (const cfg of KIND_CONFIGS) {
    const r = await fetchListWithRetry(cfg, deadline)
    if (r) lists[cfg.label] = r
    else   kindStale[cfg.label] = true
  }

  // 3. 詳細階段：抓「本次列表出現、但快取還沒有 code」的機構（時間預算內）
  const pending = []
  for (const cfg of KIND_CONFIGS) {
    const r = lists[cfg.label]; if (!r) continue
    for (const row of r.rows) {
      const ck = cacheKeyOf(row.basSeq, row.zoneSeq)
      if (!cache[ck]?.code) pending.push({ ...row, ck, cfg, cookieStr: r.session.cookieStr })
    }
  }
  log(`待抓詳細頁：${pending.length} 筆（快取已有則略過）`)

  let fetched = 0, resolved = 0, timedOut = false
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    if (Date.now() > deadline) { warn(`詳細頁已達時間預算，本次剩 ${pending.length - i} 筆未抓（下次續抓）`); timedOut = true; break }
    const batch = pending.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(p => fetchDetail(p.basSeq, p.zoneSeq, p.cookieStr)))
    for (let j = 0; j < batch.length; j++) {
      const p = batch[j], d = results[j]
      fetched++
      const kind = p.cfg.kind === 'A' ? classifyMedical(p.name) : p.cfg.label
      if (d?.code) {
        cache[p.ck] = { code: d.code, status: d.status, name: p.name, address: `${p.city}${p.dist}`, kind, fetchedAt: today.toISOString() }
        resolved++
      }
      // 抓不到 code 的不寫 cache → 下次再試
    }
    if (fetched % 200 === 0) log(`    詳細頁進度：${fetched} / ${pending.length}（解析 ${resolved}）`)
    if (i + CONCURRENCY < pending.length) await sleep(300)
  }
  log(`詳細頁完成：本次解析 ${resolved} 筆${timedOut ? '（時間預算到，未完整）' : ''}`)

  // 4. 建快照：以「本次列表集合」為準，從 cache 取 code；只收開業者。
  //    列表失敗的類別 → 沿用上月該類別 codes。未解析者 → fallback key 保留。
  const codes = {}
  let pendingRemaining = 0
  for (const cfg of KIND_CONFIGS) {
    const r = lists[cfg.label]
    if (!r) {
      // 沿用上月該類別
      for (const [code, e] of Object.entries(prevSnapshot?.codes ?? {})) {
        if (categoryLabelMatches(e.kind, cfg)) codes[code] = e
      }
      continue
    }
    for (const row of r.rows) {
      const ck = cacheKeyOf(row.basSeq, row.zoneSeq)
      const ce = cache[ck]
      const kind = cfg.kind === 'A' ? classifyMedical(row.name) : cfg.label
      const addr = `${row.city}${row.dist}`
      if (ce?.code) {
        if (isOpenStatus(ce.status)) {
          codes[ce.code] = { source: 'mohw', kind, name: row.name, address: addr, specialty: '', termDate: '', status: ce.status }
        }
        // 非開業 → 不收（代碼不在 snapshot ⇒ 觸發歇業候選），等同舊 termDate 機制
      } else {
        // 尚未解析到 code → 用名稱備用 key 保留（不會與客戶代碼比中），下次續抓
        pendingRemaining++
        codes[`${row.name}__${row.city}__${row.dist}`] = { source: 'mohw', kind, name: row.name, address: addr, specialty: '', termDate: '', status: '' }
      }
    }
  }

  // 各類別總數（供前端統計卡 / 較上月增減）
  const totalClinics   = Object.values(codes).filter(e => e.kind === '牙醫診所' || e.kind === '衛生所').length
  const totalHospitals = Object.values(codes).filter(e => e.kind === '醫院').length
  const totalLabs      = Object.values(codes).filter(e => e.kind === '牙體技術所').length
  const labsStale      = kindStale['牙體技術所'] === true
  log(`\n快照：診所/衛生所 ${totalClinics}、醫院 ${totalHospitals}、牙技所 ${totalLabs}、合計 ${Object.keys(codes).length} 筆（未解析保留 ${pendingRemaining}）`)

  // 5. 崧達客戶 + 比對
  const customers = await fetchSongtahCustomers().catch(e => { warn('載入崧達客戶失敗：', e.message); return { byCode: new Map(), byName: new Map() } })
  const currentData = new Map(Object.entries(codes))
  const changes  = buildChanges({ currentData, prevCodes: prevComparable?.codes ?? null, customers, month })
  const notFound = buildNotFoundList({ currentData, customers, prevCodes: prevComparable?.codes ?? null })

  const stopped  = changes.filter(c => c.type === '新增停業')
  const restored = changes.filter(c => c.type === '恢復開業')
  const newOpen  = changes.filter(c => c.type === '新開業')
  const closed   = changes.filter(c => c.type === '停業')
  log(`比對：新增停業 ${stopped.length}、恢復開業 ${restored.length}、新開業 ${newOpen.length}、停業 ${closed.length}、查無代碼 ${notFound.length}`)

  // 6. 寫入 Notion（失敗不影響快照寫出）
  try {
    log('寫入 Notion …')
    await writeRecord({
      type: '月份摘要', month, name: `${month} 月份摘要`,
      address: [
        `診所/衛生所：${totalClinics}`, `醫院：${totalHospitals}`, `牙技所：${totalLabs}`,
        `客戶：${customers.byCode.size}`, `客戶停業：${stopped.length}`, `客戶恢復：${restored.length}`,
        `新開業：${newOpen.length}`, `停業：${closed.length}`, `查無代碼：${notFound.length}`,
        timedOut || pendingRemaining ? `（未解析 ${pendingRemaining}，請再按更新醫事資料續抓）` : '（資料完整）',
      ].join('｜'),
      key: '', customer: '', customerUrl: '',
    })
    for (const c of [...stopped, ...restored]) await writeRecord(c)
    for (const c of newOpen) await writeRecord(c)
    for (const c of notFound) await writeRecord(c)
  } catch (e) {
    warn('寫入 Notion 失敗（不影響快照）：', e.message)
  }

  // 7. 寫出快照 + 快取（永遠寫，確保 Action 綠燈且可續跑）
  if (!DRY_RUN) {
    mkdirSync('data', { recursive: true })
    const prevCodeSet = prevComparable?.codes ? new Set(Object.keys(prevComparable.codes)) : null
    const newCodes = prevCodeSet ? [...currentData.keys()].filter(k => !prevCodeSet.has(k)) : []
    writeFileSync(SNAPSHOT_PATH, JSON.stringify({
      month, fetchedAt: today.toISOString(), source: 'mohw-bas',
      totalClinics, totalLabs, totalHospitals,
      labsStale,
      pendingRemaining,                       // >0 表示尚未抓完，按更新醫事資料可續抓
      prevTotalClinics:   prevComparable?.totalClinics,
      prevTotalLabs:      prevComparable?.totalLabs,
      prevTotalHospitals: prevComparable?.totalHospitals,
      totalCustomers: customers.byCode.size,
      newCodes,
      codes,
    }, null, 2))
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1))
    log(`Snapshot → ${SNAPSHOT_PATH}；Cache（${Object.keys(cache).length} 筆）→ ${CACHE_PATH}`)

    // 寫一筆「醫事數量趨勢」永久紀錄（全台＋客戶各類；不影響快照成敗）
    try {
      let totalSchools = 0
      if (existsSync(SCHOOLS_PATH)) {
        try { totalSchools = Object.keys(JSON.parse(readFileSync(SCHOOLS_PATH, 'utf8')).schools ?? {}).length } catch {}
      }
      await upsertTrendRow({
        month, totalClinics, totalLabs, totalHospitals, totalSchools,
        ...customers.counts,
        customerWithCode: customers.byCode.size,
      })
      log(`醫事數量趨勢 → 已寫入 ${month}`)
    } catch (e) { warn('寫入數量趨勢失敗（不影響快照）：', e.message) }
  }

  log('✅ 完成')
}

// 沿用上月時，判斷上月某 entry 是否屬於某 kind config 的類別
function categoryLabelMatches(kind, cfg) {
  if (cfg.kind === '2') return kind === '牙體技術所'
  if (cfg.kind === 'L') return kind === '鑲牙所'
  return kind === '牙醫診所' || kind === '醫院' || kind === '衛生所'  // A
}

main().catch(err => { console.error('[clinic-monitor] 致命錯誤：', err); process.exit(1) })
