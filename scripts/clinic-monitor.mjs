/**
 * scripts/clinic-monitor.mjs
 *
 * 每月比對全國健保特約牙醫診所異動，並將結果寫入 Notion「診所監控紀錄」資料庫。
 *
 * 執行方式：
 *   node scripts/clinic-monitor.mjs
 *
 * 必要環境變數：
 *   NOTION_TOKEN               — Notion Integration Token
 *   NOTION_CLINIC_MONITOR_DB   — 診所監控紀錄 DB ID
 *   NOTION_CUSTOMERS_SYSTEM_DB — 客戶主檔 DB ID（取機構代碼）
 *
 * 選用環境變數：
 *   DRY_RUN=true               — 只比對不寫入 Notion
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const NOTION_TOKEN        = process.env.NOTION_TOKEN
const CLINIC_MONITOR_DB   = process.env.NOTION_CLINIC_MONITOR_DB
const CUSTOMERS_DB        = process.env.NOTION_CUSTOMERS_SYSTEM_DB
const DRY_RUN             = process.env.DRY_RUN === 'true'
const SNAPSHOT_PATH       = 'data/clinic-snapshot.json'

// NHI 健保特約牙醫診所資料（每日更新，公開免費）
// rId A21030000I-D21004-009 = 牙醫診所特約醫事機構
const NHI_API_BASE = 'https://info.nhi.gov.tw/api/iode0000s01/Dataset'
const NHI_RID      = 'A21030000I-D21004-009'
const NHI_PAGE_SIZE = 1000

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(...args) { console.log('[clinic-monitor]', ...args) }
function warn(...args) { console.warn('[clinic-monitor] ⚠', ...args) }

/** Notion API 的 rich_text 內容 */
function richText(text) {
  return [{ type: 'text', text: { content: String(text ?? '').slice(0, 2000) } }]
}

/** 格式化月份字串 YYYY-MM → YYYY-MM-01（Notion Date 格式） */
function monthToDate(monthStr) {
  return monthStr + '-01'
}

// ── 1. 下載健保資料 ─────────────────────────────────────────────────────────

/**
 * 拉取 NHI API，自動分頁，回傳陣列。
 * 每筆格式：{ code, name, address, specialty, termDate }
 */
async function fetchNHIData() {
  log('下載健保特約牙醫診所資料…')

  const rows = []
  let offset = 0
  let total  = Infinity

  while (offset < total) {
    const url = `${NHI_API_BASE}?rId=${NHI_RID}&page=${Math.floor(offset / NHI_PAGE_SIZE) + 1}&pageSize=${NHI_PAGE_SIZE}`
    log(`  fetch offset=${offset} …`)

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      throw new Error(`NHI API 回應 ${res.status} ${res.statusText}`)
    }

    const body = await res.json()

    // 支援多種回傳格式
    let list = []
    if (Array.isArray(body)) {
      list  = body
      total = body.length  // 全量回傳
    } else if (body?.data?.list) {
      list  = body.data.list
      total = body.data.total ?? list.length
    } else if (body?.result?.records) {
      list  = body.result.records
      total = body.result.total ?? list.length
    } else if (body?.records) {
      list  = body.records
      total = body.total ?? list.length
    } else {
      // 嘗試找第一個陣列
      const arr = Object.values(body).find(Array.isArray)
      if (arr) { list = arr; total = arr.length }
      else throw new Error(`NHI API 回傳未知格式：${JSON.stringify(body).slice(0, 200)}`)
    }

    if (offset === 0 && list.length > 0) {
      log(`  第一筆範例：${JSON.stringify(list[0]).slice(0, 200)}`)
    }

    for (const row of list) {
      rows.push(mapNHIRow(row))
    }

    offset += list.length
    if (list.length < NHI_PAGE_SIZE) break  // 最後一頁
  }

  log(`健保資料：共 ${rows.length} 筆`)
  return rows
}

/** 將 NHI 原始 row 正規化（欄位名稱可能因版本而異） */
function mapNHIRow(row) {
  // 嘗試多種欄位名稱
  const code     = row['醫事機構代碼'] ?? row['機構代碼'] ?? row['code'] ?? ''
  const name     = row['醫事機構名稱'] ?? row['機構名稱'] ?? row['name'] ?? ''
  const address  = row['醫事機構地址'] ?? row['地址']     ?? row['address'] ?? ''
  const specialty= row['診療科別']     ?? row['科別']     ?? row['specialty'] ?? ''
  const termDate = row['合約終止日期'] ?? row['終止日期'] ?? row['termDate'] ?? ''
  return { code: String(code).trim(), name: String(name).trim(), address: String(address).trim(), specialty: String(specialty).trim(), termDate: String(termDate).trim() }
}

// ── 2. 載入客戶機構代碼 ──────────────────────────────────────────────────────

/**
 * 從 Notion 客戶主檔撈有填機構代碼的客戶。
 * 回傳 Map<機構代碼, { name, pageId }>
 */
async function fetchSongtahCustomers() {
  if (!CUSTOMERS_DB) { warn('未設定 NOTION_CUSTOMERS_SYSTEM_DB，跳過客戶比對'); return new Map() }
  log('載入崧達客戶機構代碼…')

  const customers = new Map()
  let cursor

  do {
    const body = {
      page_size: 100,
      filter: {
        property: '機構代碼',
        rich_text: { is_not_empty: true },
      },
    }
    if (cursor) body.start_cursor = cursor

    const res = await notionPost(`/databases/${CUSTOMERS_DB}/query`, body)
    for (const page of res.results) {
      const code = getText(page, '機構代碼').trim()
      const name = page.properties['名稱']?.title?.[0]?.plain_text
                ?? page.properties['客戶名稱']?.title?.[0]?.plain_text
                ?? page.properties['Name']?.title?.[0]?.plain_text
                ?? ''
      if (code) customers.set(code, { name, pageId: page.id })
    }
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)

  log(`崧達客戶：共 ${customers.size} 筆有機構代碼`)
  return customers
}

// ── 3. 比對邏輯 ─────────────────────────────────────────────────────────────

function buildSnapshot(data) {
  const codes = {}
  for (const row of data) {
    if (row.code) codes[row.code] = { name: row.name, address: row.address, specialty: row.specialty, termDate: row.termDate }
  }
  return codes
}

// ── 4. 寫入 Notion ───────────────────────────────────────────────────────────

const BATCH_DELAY_MS = 350  // 避免觸發 Notion rate limit（3 req/s）

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function writeClinicRecord(record) {
  if (DRY_RUN) { log(`  [DRY] ${record.type} ${record.code} ${record.name}`); return }

  const properties = {
    '標題':    { title: richText(`${record.type}｜${record.name || record.code}`) },
    '月份':    { date: { start: monthToDate(record.month) } },
    '異動類型':{ select: { name: record.type } },
  }
  if (record.code)       properties['機構代碼']  = { rich_text: richText(record.code) }
  if (record.name)       properties['健保名稱']   = { rich_text: richText(record.name) }
  if (record.customer)   properties['客戶名稱']   = { rich_text: richText(record.customer) }
  if (record.address)    properties['地址']       = { rich_text: richText(record.address) }
  if (record.specialty)  properties['診療科別']   = { rich_text: richText(record.specialty) }
  if (record.customerUrl)properties['客戶頁面']   = { url: record.customerUrl }
  if (record.termDate && /^\d{8}$/.test(record.termDate)) {
    // 格式 YYYYMMDD → YYYY-MM-DD
    const d = record.termDate
    properties['終止日期'] = { date: { start: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` } }
  }

  await notionPost('/pages', {
    parent: { database_id: CLINIC_MONITOR_DB },
    properties,
  })
  await sleep(BATCH_DELAY_MS)
}

// ── 5. Notion API helpers ────────────────────────────────────────────────────

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
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
  // 驗證必要環境變數
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
    log('找不到 snapshot，視為第一次執行，只建立快照不比對')
  }

  // 2. 下載健保資料
  const currentData = await fetchNHIData()
  const currentCodes = buildSnapshot(currentData)

  // 3. 載入崧達客戶
  const customers = await fetchSongtahCustomers()

  // 4. 比對
  const changes = []

  if (prevSnapshot?.codes) {
    const prev = prevSnapshot.codes

    // 上月有、本月沒有 → 新增停業
    for (const [code, info] of Object.entries(prev)) {
      if (!currentCodes[code]) {
        const customer = customers.get(code)
        changes.push({
          type: '新增停業',
          month,
          code,
          name: info.name,
          address: info.address,
          specialty: info.specialty,
          termDate: info.termDate,
          customer: customer?.name ?? '',
          customerUrl: customer
            ? `https://songtah-quote.vercel.app/customers/${customer.pageId}`
            : '',
        })
      }
    }

    // 本月有、上月沒有 → 恢復開業（或新開業）
    for (const [code, info] of Object.entries(currentCodes)) {
      if (!prev[code]) {
        const customer = customers.get(code)
        changes.push({
          type: '恢復開業',
          month,
          code,
          name: info.name,
          address: info.address,
          specialty: info.specialty,
          termDate: info.termDate,
          customer: customer?.name ?? '',
          customerUrl: customer
            ? `https://songtah-quote.vercel.app/customers/${customer.pageId}`
            : '',
        })
      }
    }
  }

  // 找出客戶機構代碼在健保資料中完全查無的
  for (const [code, cust] of customers) {
    if (!currentCodes[code]) {
      // 只有在沒有被記錄為「新增停業」的情況下才記
      if (!changes.some(c => c.code === code && c.type === '新增停業')) {
        changes.push({
          type: '查無代碼',
          month,
          code,
          name: '',
          customer: cust.name,
          customerUrl: `https://songtah-quote.vercel.app/customers/${cust.pageId}`,
          address: '', specialty: '', termDate: '',
        })
      }
    }
  }

  const stopped   = changes.filter(c => c.type === '新增停業')
  const restored  = changes.filter(c => c.type === '恢復開業')
  const notFound  = changes.filter(c => c.type === '查無代碼')
  const affectedCustomers = changes.filter(c => c.customer && c.type !== '查無代碼')

  log(`\n比對結果：`)
  log(`  本月健保特約診所：${Object.keys(currentCodes).length} 家`)
  log(`  新增停業：${stopped.length} 家`)
  log(`  恢復開業：${restored.length} 家`)
  log(`  查無代碼：${notFound.length} 筆（崧達客戶機構代碼不在健保清單）`)
  log(`  影響崧達客戶：${affectedCustomers.length} 家`)

  // 5. 寫入 Notion
  if (!DRY_RUN && !CLINIC_MONITOR_DB) {
    warn('未設定 NOTION_CLINIC_MONITOR_DB，跳過寫入')
  } else {
    log('\n寫入 Notion…')

    // 先寫月份摘要
    await writeClinicRecord({
      type: '月份摘要',
      month,
      code: '',
      name: `${month} 月份監控摘要`,
      address: `本月健保特約：${Object.keys(currentCodes).length} 家｜停業：${stopped.length}｜恢復：${restored.length}｜影響客戶：${affectedCustomers.length}`,
      specialty: '', termDate: '', customer: '', customerUrl: '',
    })

    // 再寫各筆異動
    for (const change of changes) {
      await writeClinicRecord(change)
    }
    log(`寫入完成：共 ${changes.length + 1} 筆`)
  }

  // 6. 更新 snapshot
  if (!DRY_RUN) {
    mkdirSync('data', { recursive: true })
    const newSnapshot = {
      month,
      fetchedAt: today.toISOString(),
      totalActive: Object.keys(currentCodes).length,
      codes: currentCodes,
    }
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(newSnapshot, null, 2))
    log(`\nSnapshot 已更新：data/clinic-snapshot.json`)
  }

  log('\n執行完成 ✅')
}

main().catch(err => {
  console.error('[clinic-monitor] 執行失敗：', err)
  process.exit(1)
})
