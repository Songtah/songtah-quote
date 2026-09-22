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
import { fetchTendersByDateRange, fetchOurBids, type TenderRecord } from '@/lib/tender-source'
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

export async function getTenders(): Promise<TenderSnapshot | null> {
  return await getRedisValue<TenderSnapshot>(KEY).catch(() => null)
}
