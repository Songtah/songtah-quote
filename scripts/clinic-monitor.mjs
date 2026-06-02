/**
 * scripts/clinic-monitor.mjs
 *
 * 每月比對全國牙科機構開業/停業，寫入 Notion「診所監控紀錄」。
 *
 * ── 資料來源 ──────────────────────────────────────────────────────────────────
 * 1. NHI API  rId=A21030000I-D21004-009（CSV）— 健保特約牙醫診所（~7,653 間）
 *    篩選種類：牙醫一般診所、牙醫診所、牙醫專科診所
 *
 * 2. MOHW BAS — https://ma.mohw.gov.tw/Accessibility/BASSearch/MASearchBAS
 *    機構類別 BAS_KIND=2 → 牙體技術所（~1,089 間）
 *    CAPTCHA：答案直接放在 img[data-code] 屬性，可直接讀取
 *
 * ── 異動類型邏輯 ──────────────────────────────────────────────────────────────
 * 新增停業  → 上月有、本月沒有 + 是崧達客戶
 * 恢復開業  → 上月沒有、本月有 + 是崧達客戶
 * 新開業    → 上月沒有、本月有 + 不是崧達客戶（業務開發機會）
 * 停業      → 上月有、本月沒有 + 不是崧達客戶
 * 查無代碼  → 崧達客戶機構代碼在兩個資料庫都查不到
 * 月份摘要  → 每月一筆統計摘要
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const NOTION_TOKEN       = process.env.NOTION_TOKEN
const CLINIC_MONITOR_DB  = process.env.NOTION_CLINIC_MONITOR_DB
const CUSTOMERS_DB       = process.env.NOTION_CUSTOMERS_SYSTEM_DB
const DRY_RUN            = process.env.DRY_RUN === 'true'
const SNAPSHOT_PATH      = 'data/clinic-snapshot.json'

const NHI_API        = 'https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21004-009'
const MOHW_SEARCH    = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/MASearchBAS'
const MOHW_RESULTS   = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BasResults'
const MOHW_DETAIL    = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData'

const DENTAL_TYPES   = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所'])

// ── Logging ─────────────────────────────────────────────────────────────────

const log  = (...a) => console.log('[clinic-monitor]', ...a)
const warn = (...a) => console.warn('[clinic-monitor] ⚠', ...a)

// ── 1. 健保特約牙醫診所（NHI CSV API）──────────────────────────────────────

async function fetchDentalClinics() {
  log('【NHI】下載健保特約牙醫診所 CSV …')

  const res = await fetch(NHI_API, {
    headers: { Accept: 'text/csv,*/*' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`NHI API → HTTP ${res.status}`)

  const raw   = await res.text()
  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('NHI API 回傳空資料')

  const headers   = parseCSVLine(lines[0])
  const codeIdx   = headers.findIndex(h => h.includes('代碼'))
  const nameIdx   = headers.findIndex(h => h.includes('名稱'))
  const kindIdx   = headers.findIndex(h => h.includes('種類'))
  const addrIdx   = headers.findIndex(h => h.includes('地址'))
  const specIdx   = headers.findIndex(h => h.includes('科別'))
  const termIdx   = headers.findIndex(h => h.includes('終止') || h.includes('歇業'))

  if (codeIdx < 0 || nameIdx < 0) throw new Error(`NHI 找不到必要欄位`)

  const result = new Map()  // key = 機構代碼
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 3) continue
    const kind = kindIdx >= 0 ? cols[kindIdx]?.trim() : ''
    if (!DENTAL_TYPES.has(kind)) continue
    const code = cols[codeIdx]?.trim()
    if (!code) continue
    result.set(code, {
      source:   'nhi',
      kind,
      name:     cols[nameIdx]?.trim()  ?? '',
      address:  addrIdx >= 0 ? cols[addrIdx]?.trim()  ?? '' : '',
      specialty:specIdx >= 0 ? cols[specIdx]?.trim()  ?? '' : '',
      termDate: termIdx >= 0 ? cols[termIdx]?.trim()  ?? '' : '',
    })
  }

  log(`  牙醫診所：${result.size} 間`)
  return result
}

function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"')              inQ = !inQ
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                         cur += ch
  }
  result.push(cur)
  return result
}

// ── 2. 牙體技術所（MOHW BAS 網頁）──────────────────────────────────────────

// HTML entity decode（BAS 回傳的中文可能是 &#x...;（hex）或 &#...;（decimal））
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

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

/**
 * 從 BASBasicData 詳細頁取出機構代碼（10 位數字）。
 * basSeq / zoneSeq 傳入 HTML href 中取出的原始字串（保留 URL 編碼，直接拼接）。
 * cookieStr 為搜尋頁取得的 session cookie，避免 WAF 拒絕。
 */
async function fetchLabCode(basSeq, zoneSeq, cookieStr) {
  const url = `${MOHW_DETAIL}?BAS_SEQ=${basSeq}&ZONE_SEQ=${zoneSeq}`
  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        'Cookie':  cookieStr,
        'Referer': MOHW_RESULTS,
      },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) return null
    const html = decodeEntities(await res.text())
    // BAS 機構代碼為英數混合（如 2Y07110045），放在機構代碼標籤後的 col-7 span 中
    const m = html.match(/機構代碼[\s\S]{0,400}?<span[^>]*>\s*([A-Za-z0-9]{5,20})\s*<\/span>/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

async function fetchDentalLabsOnce() {
  // Step 1: 取首頁，抓 CSRF token + CAPTCHA code（直接放在 img[data-code]）
  const pageRes = await fetch(MOHW_SEARCH, {
    headers: { ...BROWSER_HEADERS, 'Upgrade-Insecure-Requests': '1' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!pageRes.ok) throw new Error(`MOHW 首頁 → HTTP ${pageRes.status}`)

  const pageHtml = await pageRes.text()

  // 正確解析 cookie：取 name=value，去除 Path/HttpOnly 等屬性
  const rawCookies = pageRes.headers.getSetCookie?.() ?? []
  const cookieStr  = rawCookies.map(c => c.split(';')[0]).join('; ')

  const csrf  = (pageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
                 pageHtml.match(/value="(CfDJ[^"]+)"/))?.[1]
  const vcode = pageHtml.match(/data-code="([^"]+)"/)?.[1]

  if (!csrf || !vcode) throw new Error('無法取得 CSRF token 或 CAPTCHA code')
  log(`  CAPTCHA: ${vcode}`)

  // Step 2: POST 搜尋（BAS_KIND=2 → 牙體技術所，全台）
  const params = new URLSearchParams({
    __RequestVerificationToken: csrf,
    BAS_KIND:       '2',
    ZONE_AREA_CODE: '全部',
    ZONE_ZIP_CODE:  '全部',
    DEP_DEPT_ID:    '全部',
    BAS_NAME:       '',
    txtVCode:       vcode,
  })
  const resHtml = await fetch(MOHW_RESULTS, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type':    'application/x-www-form-urlencoded',
      'Cookie':          cookieStr,
      'Referer':         MOHW_SEARCH,
      'Origin':          'https://ma.mohw.gov.tw',
      'sec-fetch-dest':  'document',
      'sec-fetch-mode':  'navigate',
      'sec-fetch-site':  'same-origin',
      'sec-fetch-user':  '?1',
      'Cache-Control':   'max-age=0',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resHtml.ok) throw new Error(`MOHW 搜尋結果 → HTTP ${resHtml.status}`)

  const html = await resHtml.text()

  // Step 3: 解析列表，收集 {name, city, dist, basSeq, zoneSeq}
  const rawLabs = []
  const rowRe   = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let match
  while ((match = rowRe.exec(html)) !== null) {
    const row   = match[1]
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
      decodeEntities(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    )
    if (cells.length < 4) continue

    const name = cells[1]?.trim()
    const city = cells[2]?.trim()
    const dist = cells[3]?.trim()
    if (!name || name === '機構名稱') continue

    // 從連結取出 BAS_SEQ + ZONE_SEQ（保留原始 URL 編碼，直接拼接至詳細頁 URL）
    const rawSeq  = row.match(/BAS_SEQ=([^&"]+)/)?.[1]
    const rawZone = row.match(/ZONE_SEQ=([^&"]+)/)?.[1]
    if (!rawSeq) continue

    rawLabs.push({
      name, city, dist,
      basSeq:  rawSeq,
      zoneSeq: rawZone ?? '',
    })
  }

  log(`  列表解析完成：${rawLabs.length} 間牙體技術所`)
  log('  開始從詳細頁取機構代碼（每批 5 筆並行）…')

  // Step 4: 批次並行抓 BASBasicData，取得真正的「機構代碼」
  const CONCURRENCY = 5
  const result = new Map()  // key = 機構代碼
  let fetched = 0, noCode = 0

  for (let i = 0; i < rawLabs.length; i += CONCURRENCY) {
    const batch = rawLabs.slice(i, i + CONCURRENCY)
    const codes = await Promise.all(
      batch.map(lab => fetchLabCode(lab.basSeq, lab.zoneSeq, cookieStr))
    )

    for (let j = 0; j < batch.length; j++) {
      const lab  = batch[j]
      const code = codes[j]
      fetched++

      if (code) {
        result.set(code, {
          source:    'bas',
          kind:      '牙體技術所',
          name:      lab.name,
          address:   `${lab.city}${lab.dist}`,
          specialty: '',
          termDate:  '',
        })
      } else {
        noCode++
        // 取代碼失敗時以「名稱__縣市__區」當備用 key，讓快照不漏資料
        // （但這個 key 不會和客戶代碼比對到，僅用來保留紀錄）
        const fallback = `${lab.name}__${lab.city}__${lab.dist}`
        result.set(fallback, {
          source: 'bas', kind: '牙體技術所',
          name: lab.name, address: `${lab.city}${lab.dist}`,
          specialty: '', termDate: '',
        })
      }
    }

    // 每 100 筆 log 進度
    if (fetched % 100 === 0 || fetched === rawLabs.length) {
      log(`    進度：${fetched} / ${rawLabs.length}（失敗 ${noCode} 筆）`)
    }

    // 批次間短暫休息，避免對伺服器造成壓力
    if (i + CONCURRENCY < rawLabs.length) await sleep(300)
  }

  log(`  牙體技術所完成：${result.size - noCode} 間有機構代碼，${noCode} 間取碼失敗`)
  return result
}

/** 最多重試 MAX_RETRY 次（每次重新取首頁 + CAPTCHA）*/
async function fetchDentalLabs(maxRetry = 3) {
  log('【MOHW BAS】下載牙體技術所資料 …')
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      return await fetchDentalLabsOnce()
    } catch (e) {
      if (attempt < maxRetry) {
        warn(`BAS 第 ${attempt} 次失敗（${e.message}），5 秒後重試 …`)
        await sleep(5_000)
      } else {
        throw e
      }
    }
  }
}

// ── 3. 崧達客戶機構代碼 ────────────────────────────────────────────────────

async function fetchSongtahCustomers() {
  if (!CUSTOMERS_DB) {
    warn('未設定 NOTION_CUSTOMERS_SYSTEM_DB，跳過客戶比對')
    return { byCode: new Map(), byName: new Map() }
  }
  log('載入崧達客戶機構代碼 …')

  const byCode = new Map()  // 機構代碼 → { name, pageId }
  const byName = new Map()  // 機構名稱（正規化）→ { name, pageId, code }
  let cursor

  do {
    const body = {
      page_size: 100,
      filter: { property: '機構代碼', rich_text: { is_not_empty: true } },
    }
    if (cursor) body.start_cursor = cursor
    const res = await notionPost(`/databases/${CUSTOMERS_DB}/query`, body)

    for (const page of res.results) {
      const code = getText(page, '機構代碼').trim()
      const name =
        page.properties['名稱']?.title?.[0]?.plain_text      ??
        page.properties['客戶名稱']?.title?.[0]?.plain_text  ??
        page.properties['Name']?.title?.[0]?.plain_text      ?? ''
      if (!code) continue
      const entry = { name, pageId: page.id, code }
      byCode.set(code, entry)
      byName.set(normalizeName(name), entry)
    }
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)

  log(`  有機構代碼的客戶：${byCode.size} 筆`)
  return { byCode, byName }
}

/** 名稱正規化（去空格、去常見後綴）用於模糊比對牙技所 */
function normalizeName(name) {
  return name.replace(/\s+/g, '').replace(/有限公司|股份有限公司|診所|技術所|牙醫|牙體/g, '')
}

// ── 4. 比對 ─────────────────────────────────────────────────────────────────

function buildChanges({ currentData, prevCodes, customers, month }) {
  const changes = []
  if (!prevCodes) { log('第一次執行，只建快照'); return changes }

  const prevSet    = new Set(Object.keys(prevCodes))
  const currentSet = new Set(currentData.keys())

  // 上月有、本月沒有 → 停業
  for (const key of prevSet) {
    if (currentSet.has(key)) continue
    const prev = prevCodes[key]
    const cust = matchCustomer(customers, key, prev)
    changes.push({
      type: cust ? '新增停業' : '停業',
      month, key,
      name:     prev.name,
      address:  prev.address ?? '',
      specialty:prev.specialty ?? '',
      kind:     prev.kind ?? '',
      termDate: prev.termDate ?? '',
      source:   prev.source ?? '',
      customer:    cust?.name  ?? '',
      customerUrl: cust ? custUrl(cust.pageId) : '',
    })
  }

  // 本月有、上月沒有 → 新開業 / 恢復開業
  for (const [key, info] of currentData) {
    if (prevSet.has(key)) continue
    const cust = matchCustomer(customers, key, info)
    changes.push({
      type: cust ? '恢復開業' : '新開業',
      month, key,
      name:     info.name,
      address:  info.address,
      specialty:info.specialty,
      kind:     info.kind,
      termDate: info.termDate,
      source:   info.source,
      customer:    cust?.name  ?? '',
      customerUrl: cust ? custUrl(cust.pageId) : '',
    })
  }

  return changes
}

/**
 * 比對客戶：
 * - NHI 牙醫診所：用機構代碼（key）比對 byCode
 * - MOHW 牙技所：key 是 BAS_SEQ，改用名稱模糊比對 byName
 */
function matchCustomer(customers, key, info) {
  const { byCode, byName } = customers
  // 先試代碼比對（NHI 資料的 key 就是機構代碼）
  if (byCode.has(key)) return byCode.get(key)
  // 再試名稱比對（牙技所用）
  const norm = normalizeName(info.name ?? '')
  if (norm && byName.has(norm)) return byName.get(norm)
  return null
}

function buildNotFoundList({ currentData, customers, prevCodes }) {
  // 第一次執行（無 snapshot）時跳過，避免把所有不在 NHI 的客戶都誤報為查無代碼
  if (!prevCodes) return []

  const result = []
  for (const [code, cust] of customers.byCode) {
    if (!currentData.has(code)) {
      // 上月也查不到 → 已知問題，不重複寫入
      if (code in prevCodes) continue
      result.push({ type: '查無代碼', code, customer: cust.name, customerUrl: custUrl(cust.pageId) })
    }
  }
  return result
}

const custUrl = id => `https://songtah-quote.vercel.app/customers/${id}`

// ── 5. 寫入 Notion ───────────────────────────────────────────────────────────

const DELAY_MS = 340

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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

  const kindLabel = rec.kind === '牙體技術所' ? '牙體技術所' : (rec.kind || '')
  const props = {
    '標題':    { title:  richText(title) },
    '異動類型':{ select: { name: rec.type } },
  }
  if (rec.month)       props['月份']     = { date: { start: rec.month + '-01' } }
  if (rec.key || rec.code)
                       props['機構代碼'] = { rich_text: richText(rec.key || rec.code || '') }
  if (rec.name)        props['健保名稱'] = { rich_text: richText(rec.name) }
  if (rec.customer)    props['客戶名稱'] = { rich_text: richText(rec.customer) }
  if (rec.address)     props['地址']     = { rich_text: richText(rec.address) }
  if (rec.specialty || kindLabel)
                       props['診療科別'] = { rich_text: richText(rec.specialty || kindLabel) }
  if (rec.customerUrl) props['客戶頁面'] = { url: rec.customerUrl }
  if (rec.termDate && /^\d{8}$/.test(rec.termDate)) {
    const d = rec.termDate
    props['終止日期'] = { date: { start: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` } }
  }

  await notionPost('/pages', { parent: { database_id: CLINIC_MONITOR_DB }, properties: props })
  await sleep(DELAY_MS)
}

// ── 6. Notion helpers ────────────────────────────────────────────────────────

const richText = t => [{ type: 'text', text: { content: String(t ?? '').slice(0, 2000) } }]

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

const getText = (page, f) =>
  page.properties[f]?.rich_text?.map(t => t.plain_text).join('') ?? ''

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!NOTION_TOKEN)      throw new Error('缺少 NOTION_TOKEN')
  if (!CLINIC_MONITOR_DB) throw new Error('缺少 NOTION_CLINIC_MONITOR_DB')

  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  log(`月份：${month}${DRY_RUN ? '（DRY RUN）' : ''}`)

  // 1. 上月 snapshot
  let prevSnapshot = null
  if (existsSync(SNAPSHOT_PATH)) {
    try {
      prevSnapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
      log(`上月快照：${Object.keys(prevSnapshot.codes ?? {}).length} 筆（${prevSnapshot.month}）`)
    } catch (e) { warn('解析 snapshot 失敗，視為首次執行') }
  } else {
    log('無 snapshot，首次執行')
  }

  // 2. 下載兩個資料來源（並行）
  const [clinics, labs] = await Promise.all([
    fetchDentalClinics(),
    fetchDentalLabs().catch(e => { warn('牙技所資料取得失敗：', e.message); return new Map() }),
  ])

  // 合併（NHI key = 機構代碼，BAS key = BAS_SEQ）
  const currentData = new Map([...clinics, ...labs])
  log(`\n合計：${clinics.size} 牙醫診所 ＋ ${labs.size} 牙技所 ＝ ${currentData.size} 筆`)

  // 3. 崧達客戶
  const customers = await fetchSongtahCustomers().catch(e => {
    warn('載入崧達客戶失敗：', e.message, '— 繼續執行（無客戶比對）')
    return { byCode: new Map(), byName: new Map() }
  })

  // 4. 比對
  const changes  = buildChanges({ currentData, prevCodes: prevSnapshot?.codes ?? null, customers, month })
  const notFound = buildNotFoundList({ currentData, customers, prevCodes: prevSnapshot?.codes ?? null })

  const stopped       = changes.filter(c => c.type === '新增停業')
  const restored      = changes.filter(c => c.type === '恢復開業')
  const newOpen       = changes.filter(c => c.type === '新開業')
  const closedNonCust = changes.filter(c => c.type === '停業')

  const newOpenClinics = newOpen.filter(c => c.kind !== '牙體技術所')
  const newOpenLabs    = newOpen.filter(c => c.kind === '牙體技術所')

  log(`\n比對結果：`)
  log(`  新增停業（客戶）：${stopped.length}`)
  log(`  恢復開業（客戶）：${restored.length}`)
  log(`  新開業（業務機會）：${newOpen.length}（牙醫診所 ${newOpenClinics.length}、牙技所 ${newOpenLabs.length}）`)
  log(`  停業（非客戶）：${closedNonCust.length}`)
  log(`  查無代碼：${notFound.length}`)

  // 5. 寫入 Notion
  if (CLINIC_MONITOR_DB) {
    log('\n寫入 Notion …')

    // 月份摘要
    await writeRecord({
      type: '月份摘要', month,
      name: `${month} 月份摘要`,
      address: [
        `牙醫診所：${clinics.size}`,
        `牙體技術所：${labs.size}`,
        `崧達客戶：${customers.byCode.size}`,
        `客戶停業：${stopped.length}`,
        `客戶恢復：${restored.length}`,
        `新診所（業務）：${newOpenClinics.length}`,
        `新牙技所（業務）：${newOpenLabs.length}`,
        `停業（非客戶）：${closedNonCust.length}`,
        `查無代碼：${notFound.length}`,
      ].join('｜'),
      key: '', customer: '', customerUrl: '',
    })

    // 客戶異動（優先）
    for (const c of [...stopped, ...restored]) await writeRecord(c)
    // 業務開發新診所
    for (const c of newOpen) await writeRecord(c)
    // 查無代碼
    for (const c of notFound) await writeRecord(c)

    log(`寫入完成：${1 + stopped.length + restored.length + newOpen.length + notFound.length} 筆`)
  }

  // 6. 更新 snapshot
  if (!DRY_RUN) {
    mkdirSync('data', { recursive: true })   // 確保目錄存在（首次執行時）

    // 計算本月相較上月新增的代碼（真正新開業）
    // 若無上月快照（首次執行）則 newCodes 為空陣列
    const prevCodeSet = prevSnapshot?.codes ? new Set(Object.keys(prevSnapshot.codes)) : null
    const newCodes = prevCodeSet
      ? [...currentData.keys()].filter(k => !prevCodeSet.has(k))
      : []
    log(`本月新增代碼：${newCodes.length} 筆（vs 上月 ${prevCodeSet?.size ?? 0} 筆）`)

    const codes = {}
    for (const [k, v] of currentData) codes[k] = v
    writeFileSync(SNAPSHOT_PATH, JSON.stringify({
      month, fetchedAt: today.toISOString(),
      totalClinics: clinics.size, totalLabs: labs.size,
      totalCustomers: customers.byCode.size,
      newCodes,   // 本月相較上月新增的機構代碼（真正新開業）
      codes,
    }, null, 2))
    log(`\nSnapshot 更新：${currentData.size} 筆 → ${SNAPSHOT_PATH}`)
  }

  log('\n✅ 完成')
}

main().catch(err => { console.error('[clinic-monitor]', err); process.exit(1) })
