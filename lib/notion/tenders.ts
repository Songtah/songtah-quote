/**
 * lib/notion/tenders.ts — 政府標案機會（組合層）
 *
 * 流程：逐日全量掃描政府電子採購網 → 兩級關鍵字＋情境過濾 → 補明細與決標結果
 *       → 比對客戶主檔 → upsert 進 Notion「政府標案」DB → 快取一份供頁面即時讀取。
 *
 * 完整性：不再用關鍵字搜尋（只比標題、分頁有上限），改逐日取回當日全部公告在本地過濾，
 * 實測 15 天 18,190 則公告 → 19 案牙科相關，13 秒。
 * 即時性：每日多次排程只掃「上次掃到之後」的日期，日常成本 1～3 個請求。
 *
 * 客戶比對沿用全系統鐵則：**名稱＋縣市**，名稱單獨一律不配。
 */
import { getRedisValue, setRedisValue } from './shared'
import { getAllSystemCustomers } from './customers'
import { customerNameStem } from '@/lib/customer-name-match'
import { fetchTendersByDateRange, fetchOurBids, matchKeywords, type TenderRecord } from '@/lib/tender-source'
import { fetchOfficialRecent } from '@/lib/tender-official'
import { upsertTenders, listTenderRows, type TenderRow } from './tenders-db'

export type TenderOpportunity = TenderRow & { matchNote: string }

export type TenderSnapshot = {
  records: TenderOpportunity[]
  computedAt: string
  lastScannedDate: string
  scannedDays: number
  scannedRecords: number
}

const KEY = 'tenders-v2'
const CURSOR_KEY = 'tenders-cursor-v1'
const TTL_MS = 7 * 24 * 3600_000

const tw = (s: string) => (s ?? '').replace(/臺/g, '台')
const nameKey = (s: string) => tw(s).replace(/[（）()\s\-_]/g, '')

type Matcher = (r: { unitName: string; city: string }) => { customerId: string; customerName: string; salesperson: string; note: string }

async function buildCustomerMatcher(): Promise<Matcher> {
  const customers = await getAllSystemCustomers().catch(() => [])
  const byName = new Map<string, typeof customers>()
  for (const c of customers) {
    const k = nameKey(c.name)
    if (!k) continue
    const list = byName.get(k) ?? []
    list.push(c)
    byName.set(k, list)
  }
  return (r) => {
    const exact = byName.get(nameKey(r.unitName)) ?? []
    const stem = customerNameStem(r.unitName)
    const cands = exact.length ? exact : (stem ? (byName.get(nameKey(stem)) ?? []) : [])
    if (cands.length === 0) return { customerId: '', customerName: '', salesperson: '', note: '尚未建檔' }
    if (r.city) {
      const sameCity = cands.filter((c) => tw(c.city) === tw(r.city))
      if (sameCity.length === 1) {
        return { customerId: sameCity[0].id, customerName: sameCity[0].name, salesperson: sameCity[0].salesperson, note: `名稱＋縣市相符：${r.city}` }
      }
      if (sameCity.length > 1) return { customerId: '', customerName: '', salesperson: '', note: `同縣市有 ${sameCity.length} 家同名，未配對` }
      return { customerId: '', customerName: '', salesperson: '', note: '同名客戶不在該縣市，未配對' }
    }
    if (cands.length === 1) {
      return { customerId: cands[0].id, customerName: cands[0].name, salesperson: cands[0].salesperson, note: '名稱唯一相符（無地址可比）' }
    }
    return { customerId: '', customerName: '', salesperson: '', note: `名稱相符 ${cands.length} 家，未配對` }
  }
}

/**
 * 抓取並寫入 DB。
 * - full=true：回補 days 天（預設 120），初次建立或補資料用
 * - 否則：從上次掃到的日期＋1 開始（重疊一天避免當日公告尚未齊全）
 */
export async function refreshTenders(options?: { days?: number; full?: boolean }): Promise<TenderSnapshot> {
  const today = new Date().toISOString().slice(0, 10)
  const cursor = options?.full ? null : await getRedisValue<string>(CURSOR_KEY).catch(() => null)
  const from = options?.full || !cursor
    ? new Date(Date.now() - (options?.days ?? 120) * 86400_000).toISOString().slice(0, 10)
    : new Date(new Date(cursor).getTime() - 86400_000).toISOString().slice(0, 10)   // 重疊一天

  const [{ records, scannedDays, scannedRecords }, ourBids, match] = await Promise.all([
    fetchTendersByDateRange({ from, to: today, withDetail: true }),
    fetchOurBids('崧達'),
    buildCustomerMatcher(),
  ])

  const upsertInput = records.map((r: TenderRecord) => {
    const m = match({ unitName: r.unitName, city: r.city })
    const awarded = /^決標公告/.test(r.type) && Boolean(r.winner)
    return {
      ...r,
      customerId: m.customerId || undefined,
      weBid: ourBids.has(r.id),
      dataSource: '即時API' as const,
      autoStatus: awarded
        ? (/崧達/.test(r.winner) ? '得標' as const : '未得標' as const)
        : undefined,
    }
  })
  await upsertTenders(upsertInput)
  await setRedisValue(CURSOR_KEY, today, 400 * 24 * 3600_000)

  return await rebuildSnapshot({ scannedDays, scannedRecords, lastScannedDate: today })
}

/** 從 DB 讀回全部標案並快取（頁面讀這份，不直接打 Notion） */
export async function rebuildSnapshot(meta?: { scannedDays?: number; scannedRecords?: number; lastScannedDate?: string }): Promise<TenderSnapshot> {
  const [rows, match] = await Promise.all([listTenderRows(), buildCustomerMatcher()])
  const records: TenderOpportunity[] = rows.map((r) => {
    const m = match({ unitName: r.unitName, city: r.city })
    return { ...r, customerName: m.customerName, matchNote: m.note, customerId: r.customerId || m.customerId }
  })
  const snapshot: TenderSnapshot = {
    records,
    computedAt: new Date().toISOString(),
    lastScannedDate: meta?.lastScannedDate ?? '',
    scannedDays: meta?.scannedDays ?? 0,
    scannedRecords: meta?.scannedRecords ?? 0,
  }
  await setRedisValue(KEY, snapshot, TTL_MS)
  return snapshot
}

/**
 * 官方開放資料補寫（政府資料開放授權條款，可商用）。
 *
 * ⚠️ 實測限制：官方半月檔每期只有約 400 筆招標＋190 筆決標，而同期實際公告約 9,000 筆
 * ——它是**節錄**不是全量，且落後約兩個月。所以官方檔只能當「可商用的佐證層」，
 * 補上它有涵蓋到的那些案子（特別是決標金額與得標廠商），不能當主來源。
 */
export async function refreshFromOfficial(periods = 4): Promise<{ scanned: number; dental: number; upserted: number }> {
  const { records } = await fetchOfficialRecent(periods)
  const match = await buildCustomerMatcher()
  const dental = records.filter((r) =>
    matchKeywords({ title: r.title, unitName: r.unitName, category: r.procurementAttr }))

  const byCase = new Map<string, any>()
  for (const r of dental) {
    const id = `official|${r.jobNumber}`
    const prev = byCase.get(id)
    const m = match({ unitName: r.unitName, city: (r.address.match(/(台北市|臺北市|新北市|基隆市|桃園市|新竹[市縣]|苗栗縣|台中市|臺中市|彰化縣|南投縣|雲林縣|嘉義[市縣]|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/)?.[1] ?? '').replace('台', '臺') })
    const rec = {
      id, unitId: '', jobNumber: r.jobNumber, unitName: r.unitName, title: r.title,
      type: r.kind === 'award' ? '決標公告' : (r.procurementType || '招標公告'),
      date: r.date, category: r.procurementAttr,
      matched: matchKeywords({ title: r.title, unitName: r.unitName, category: r.procurementAttr })?.matched ?? [],
      tier: 1 as const,
      budget: null, budgetText: '', deadline: '',
      address: r.address, city: '', district: '',
      contact: r.contact, phone: r.phone, url: '',
      winner: r.winners[0] ?? '', awardAmount: r.awardAmount, basePrice: null,
      bidders: [...r.winners, ...r.losers],
      customerId: m.customerId || undefined,
      dataSource: '官方開放資料' as const,
    }
    // 同一案號的決標資料優先（欄位比招標檔完整）
    if (!prev || r.kind === 'award') byCase.set(id, rec)
  }

  const list = Array.from(byCase.values())
  if (list.length) await upsertTenders(list)
  await rebuildSnapshot().catch(() => null)
  return { scanned: records.length, dental: dental.length, upserted: list.length }
}

export async function getTenders(): Promise<TenderSnapshot | null> {
  return await getRedisValue<TenderSnapshot>(KEY).catch(() => null)
}
