/**
 * scripts/clinic-monitor.mjs
 *
 * 每月比對全國健保特約牙醫診所＋牙體技術所異動，寫入 Notion「診所監控紀錄」。
 *
 * ── 資料來源 ──────────────────────────────────────────────────────────────────
 * NHI API rId=A21030000I-D21004-009（每日更新，免費，CSV 格式）
 * 篩選機構種類：牙醫一般診所、牙醫診所、牙醫專科診所
 * ※ 牙體技術所：目前健保特約資料庫不收錄，請參閱 README 了解替代方案。
 *
 * ── 異動類型邏輯 ──────────────────────────────────────────────────────────────
 * 新增停業  → 上月有、本月沒有 + 是崧達客戶
 * 恢復開業  → 上月沒有、本月有 + 是崧達客戶（且上上月曾出現過）
 * 新開業    → 上月沒有、本月有 + 不是崧達客戶 → 業務開發機會
 * 停業      → 上月有、本月沒有 + 不是崧達客戶
 * 查無代碼  → 崧達客戶有機構代碼，但在健保清單完全查不到
 * 月份摘要  → 每月一筆統計摘要
 *
 * ── 執行方式 ──────────────────────────────────────────────────────────────────
 * node scripts/clinic-monitor.mjs
 *
 * ── 環境變數 ──────────────────────────────────────────────────────────────────
 * NOTION_TOKEN               必要  Notion Integration Token
 * NOTION_CLINIC_MONITOR_DB   必要  診所監控紀錄 DB ID
 * NOTION_CUSTOMERS_SYSTEM_DB 建議  客戶主檔 DB ID（取機構代碼）
 * DRY_RUN=true               選用  只比對，不寫 Notion、不更新 snapshot
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const NOTION_TOKEN       = process.env.NOTION_TOKEN
const CLINIC_MONITOR_DB  = process.env.NOTION_CLINIC_MONITOR_DB
const CUSTOMERS_DB       = process.env.NOTION_CUSTOMERS_SYSTEM_DB
const DRY_RUN            = process.env.DRY_RUN === 'true'
const SNAPSHOT_PATH      = 'data/clinic-snapshot.json'

// NHI API — 回傳所有健保特約醫事機構，CSV 格式
const NHI_API  = 'https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21004-009'

// 篩選的機構種類（僅保留牙科相關）
const DENTAL_TYPES = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所'])

// ── Logging ─────────────────────────────────────────────────────────────────

function log(...args)  { console.log('[clinic-monitor]', ...args) }
function warn(...args) { console.warn('[clinic-monitor] ⚠', ...args) }

// ── 1. 下載並解析健保 CSV ───────────────────────────────────────────────────

/**
 * 下載 NHI API（一次性全量 CSV），解析後篩選牙科機構。
 * 回傳 Map<機構代碼, { name, address, specialty, kind, termDate }>
 */
async function fetchDentalData() {
  log('下載健保特約醫事機構資料…')

  const res = await fetch(NHI_API, {
    headers: { Accept: 'text/csv,*/*' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`NHI API → HTTP ${res.status}`)

  const raw = await res.text()
  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('NHI API 回傳空資料')

  // 解析 CSV header（第一行）
  const headers = parseCSVLine(lines[0])
  log(`  欄位（${headers.length}）：${headers.slice(0,6).join('、')} …`)

  const codeIdx     = headers.findIndex(h => h.includes('代碼'))
  const nameIdx     = headers.findIndex(h => h.includes('名稱'))
  const kindIdx     = headers.findIndex(h => h.includes('種類'))
  const addrIdx     = headers.findIndex(h => h.includes('地址'))
  const specIdx     = headers.findIndex(h => h.includes('科別'))
  const termIdx     = headers.findIndex(h => h.includes('終止') || h.includes('歇業'))

  if (codeIdx < 0 || nameIdx < 0) throw new Error(`找不到必要欄位 code=${codeIdx} name=${nameIdx}`)

  const result = new Map()
  let total = 0, dental = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 3) continue
    total++
    const kind = kindIdx >= 0 ? cols[kindIdx]?.trim() : ''
    if (!DENTAL_TYPES.has(kind)) continue
    dental++
    const code = cols[codeIdx]?.trim()
    if (!code) continue
    result.set(code, {
      name:     cols[nameIdx]?.trim()  ?? '',
      address:  addrIdx >= 0 ? cols[addrIdx]?.trim()  ?? '' : '',
      specialty:specIdx >= 0 ? cols[specIdx]?.trim()  ?? '' : '',
      kind,
      termDate: termIdx >= 0 ? cols[termIdx]?.trim()  ?? '' : '',
    })
  }

  log(`  全機構 ${total} 筆，篩選出牙科 ${dental} 筆（${result.size} 個機構代碼）`)
  return result
}

/** 簡易 CSV 行解析（處理雙引號包裹的欄位） */
function parseCSVLine(line) {
  const result = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else { cur += ch }
  }
  result.push(cur)
  return result
}

// ── 2. 載入崧達客戶機構代碼 ────────────────────────────────────────────────

/**
 * 從 Notion 客戶主檔撈有填「機構代碼」的客戶。
 * 回傳 Map<機構代碼, { name, pageId }>
 */
async function fetchSongtahCustomers() {
  if (!CUSTOMERS_DB) {
    warn('未設定 NOTION_CUSTOMERS_SYSTEM_DB，跳過客戶比對（所有異動將視為非客戶）')
    return new Map()
  }
  log('載入崧達客戶機構代碼…')

  const customers = new Map()
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
      if (code) customers.set(code, { name, pageId: page.id })
    }
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)

  log(`  崧達客戶：${customers.size} 筆有機構代碼`)
  return customers
}

// ── 3. 比對邏輯 ─────────────────────────────────────────────────────────────

function buildChanges({ currentData, prevCodes, customers, month }) {
  const changes = []

  if (!prevCodes) {
    log('第一次執行（無上月 snapshot），只建立快照，不產生異動紀錄')
    return changes
  }

  const prevSet    = new Set(Object.keys(prevCodes))
  const currentSet = new Set(currentData.keys())

  // ── 上月有、本月沒有 → 停業 ─────────────────────────────────────────────
  for (const code of prevSet) {
    if (currentSet.has(code)) continue
    const prev     = prevCodes[code]
    const customer = customers.get(code)
    changes.push({
      type:        customer ? '新增停業' : '停業',
      month, code,
      name:        prev.name,
      address:     prev.address,
      specialty:   prev.specialty,
      kind:        prev.kind ?? '',
      termDate:    prev.termDate ?? '',
      customer:    customer?.name  ?? '',
      customerUrl: customer ? customerUrl(customer.pageId) : '',
    })
  }

  // ── 本月有、上月沒有 → 新開業 / 恢復開業 ───────────────────────────────
  for (const [code, info] of currentData) {
    if (prevSet.has(code)) continue
    const customer = customers.get(code)
    changes.push({
      type:        customer ? '恢復開業' : '新開業',
      month, code,
      name:        info.name,
      address:     info.address,
      specialty:   info.specialty,
      kind:        info.kind,
      termDate:    info.termDate,
      customer:    customer?.name  ?? '',
      customerUrl: customer ? customerUrl(customer.pageId) : '',
    })
  }

  return changes
}

/** 崧達客戶的機構代碼完全不在健保清單 */
function buildNotFoundList({ currentData, customers, prevCodes }) {
  const result = []
  for (const [code, cust] of customers) {
    if (!currentData.has(code)) {
      // 若已記錄為「新增停業」則不重複計入
      const wasInPrev = prevCodes && code in prevCodes
      if (!wasInPrev) {
        result.push({
          type: '查無代碼', code,
          customer: cust.name,
          customerUrl: customerUrl(cust.pageId),
        })
      }
    }
  }
  return result
}

function customerUrl(pageId) {
  return `https://songtah-quote.vercel.app/customers/${pageId}`
}

// ── 4. 寫入 Notion ───────────────────────────────────────────────────────────

const BATCH_DELAY_MS = 340  // 避免 Notion rate limit（3 req/s）

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function writeRecord(rec) {
  if (DRY_RUN) {
    log(`  [DRY] ${rec.type} ${rec.code || ''} ${rec.name || rec.customer}`)
    return
  }

  // 依異動類型決定標題
  let titleStr
  switch (rec.type) {
    case '月份摘要': titleStr = rec.name; break
    case '新開業':   titleStr = `🆕 ${rec.name || rec.code}`; break
    case '新增停業': titleStr = `🚨 ${rec.name || rec.code}（${rec.customer}）`; break
    case '恢復開業': titleStr = `✅ ${rec.name || rec.code}（${rec.customer}）`; break
    case '停業':     titleStr = `⬜ ${rec.name || rec.code}`; break
    default:         titleStr = `${rec.type}｜${rec.name || rec.code}`
  }

  const props = {
    '標題':    { title:  richText(titleStr) },
    '異動類型':{ select: { name: rec.type } },
  }
  if (rec.month)       props['月份']     = { date: { start: rec.month + '-01' } }
  if (rec.code)        props['機構代碼'] = { rich_text: richText(rec.code) }
  if (rec.name)        props['健保名稱'] = { rich_text: richText(rec.name) }
  if (rec.customer)    props['客戶名稱'] = { rich_text: richText(rec.customer) }
  if (rec.address)     props['地址']     = { rich_text: richText(rec.address) }
  if (rec.specialty)   props['診療科別'] = { rich_text: richText(rec.specialty) }
  if (rec.customerUrl) props['客戶頁面'] = { url: rec.customerUrl }
  if (rec.termDate && /^\d{8}$/.test(rec.termDate)) {
    const d = rec.termDate
    props['終止日期'] = { date: { start: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` } }
  }

  await notionPost('/pages', {
    parent: { database_id: CLINIC_MONITOR_DB },
    properties: props,
  })
  await sleep(BATCH_DELAY_MS)
}

// ── 5. Notion helpers ────────────────────────────────────────────────────────

function richText(text) {
  return [{ type: 'text', text: { content: String(text ?? '').slice(0, 2000) } }]
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Notion POST ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function getText(page, field) {
  return page.properties[field]?.rich_text?.map(t => t.plain_text).join('') ?? ''
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!NOTION_TOKEN)      throw new Error('缺少 NOTION_TOKEN')
  if (!CLINIC_MONITOR_DB) throw new Error('缺少 NOTION_CLINIC_MONITOR_DB')

  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  log(`執行月份：${month}${DRY_RUN ? '（DRY RUN）' : ''}`)

  // 1. 載入上月 snapshot
  let prevSnapshot = null
  if (existsSync(SNAPSHOT_PATH)) {
    try {
      prevSnapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
      log(`上月 snapshot：${Object.keys(prevSnapshot.codes ?? {}).length} 筆（${prevSnapshot.month}）`)
    } catch (e) {
      warn('無法解析 snapshot，視為第一次執行：', e.message)
    }
  } else {
    log('找不到 snapshot，視為第一次執行')
  }

  // 2. 下載健保牙科資料
  const currentData = await fetchDentalData()

  // 3. 載入崧達客戶
  const customers = await fetchSongtahCustomers()

  // 4. 比對
  const changes    = buildChanges({
    currentData,
    prevCodes: prevSnapshot?.codes ?? null,
    customers,
    month,
  })
  const notFound   = buildNotFoundList({
    currentData,
    customers,
    prevCodes: prevSnapshot?.codes ?? null,
  })

  // 統計
  const stopped          = changes.filter(c => c.type === '新增停業')
  const restored         = changes.filter(c => c.type === '恢復開業')
  const newOpen          = changes.filter(c => c.type === '新開業')
  const closedNonCust    = changes.filter(c => c.type === '停業')
  const custAffected     = [...stopped, ...restored]

  log(`\n比對結果：`)
  log(`  本月牙醫機構（健保特約）：${currentData.size} 間`)
  log(`  新增停業（客戶）：${stopped.length}`)
  log(`  恢復開業（客戶）：${restored.length}`)
  log(`  新開業（非客戶/業務機會）：${newOpen.length}`)
  log(`  停業（非客戶）：${closedNonCust.length}`)
  log(`  查無代碼：${notFound.length}`)

  // 5. 寫入 Notion
  if (CLINIC_MONITOR_DB) {
    log('\n寫入 Notion…')

    // 月份摘要（第一筆）
    await writeRecord({
      type: '月份摘要',
      month,
      name: `${month} 月份監控摘要`,
      address: [
        `健保牙醫：${currentData.size} 間`,
        `客戶停業：${stopped.length}`,
        `客戶恢復：${restored.length}`,
        `新診所（業務）：${newOpen.length}`,
      ].join('｜'),
      code: '', customer: '', customerUrl: '',
    })

    // 客戶相關優先寫（停業、恢復）
    for (const c of custAffected) await writeRecord(c)

    // 業務開發新診所（只寫非客戶新開業，停業非客戶省略以節省 API）
    for (const c of newOpen)      await writeRecord(c)

    // 查無代碼
    for (const c of notFound)     await writeRecord(c)

    const total = 1 + custAffected.length + newOpen.length + notFound.length
    log(`寫入完成：共 ${total} 筆`)
  }

  // 6. 更新 snapshot
  if (!DRY_RUN) {
    const codes = {}
    for (const [code, info] of currentData) codes[code] = info
    const snap = { month, fetchedAt: today.toISOString(), totalDental: currentData.size, codes }
    mkdirSync('data', { recursive: true })
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2))
    log(`\nSnapshot 已更新（${currentData.size} 筆）→ ${SNAPSHOT_PATH}`)
  }

  log('\n執行完成 ✅')
}

main().catch(err => {
  console.error('[clinic-monitor] 執行失敗：', err)
  process.exit(1)
})
