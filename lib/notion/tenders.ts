/**
 * lib/notion/tenders.ts — 政府標案機會（組合層）
 *
 * 抓取政府電子採購網的牙科相關標案（lib/tender-source），與客戶主檔比對後存 Redis，
 * 供 /bd「標案機會」分頁讀取。第一期只做「看得到」：不寫 Notion、不改客戶資料。
 *
 * 客戶比對沿用全系統的鐵則：**名稱＋縣市（＋行政區）**，名稱單獨一律不配——
 * 全台同名機構很多（「致臻牙體技術所」在桃園、臺中、高雄都有），只比名稱會掛錯客戶。
 */
import { getRedisValue, setRedisValue } from './shared'
import { getAllSystemCustomers } from './customers'
import { customerNameStem } from '@/lib/customer-name-match'
import { fetchDentalTenders, type TenderRecord } from '@/lib/tender-source'

export type TenderOpportunity = TenderRecord & {
  /** 比對到的客戶（機關本身就是我們的客戶時） */
  customerId: string
  customerName: string
  customerSalesperson: string
  matchNote: string
}

export type TenderSnapshot = {
  records: TenderOpportunity[]
  stats: Record<string, { fetched: number; kept: number }>
  computedAt: string
  days: number
}

const KEY = 'tenders-v1'
const TTL_MS = 3 * 24 * 3600_000

const tw = (s: string) => (s ?? '').replace(/臺/g, '台')
const nameKey = (s: string) => tw(s).replace(/[（）()\s\-_]/g, '')

/** 全部重抓並比對客戶；由每日排程呼叫，請求路徑只讀快取 */
export async function refreshTenders(options?: { days?: number; maxPagesPerKeyword?: number }): Promise<TenderSnapshot> {
  const { records, stats } = await fetchDentalTenders({
    days: options?.days ?? 120,
    maxPagesPerKeyword: options?.maxPagesPerKeyword ?? 3,
    withDetail: true,
  })

  const customers = await getAllSystemCustomers().catch(() => [])
  // 名稱索引：一個名稱可能對到多家（不同縣市），故存陣列
  const byName = new Map<string, typeof customers>()
  for (const c of customers) {
    const k = nameKey(c.name)
    if (!k) continue
    const list = byName.get(k) ?? []
    list.push(c)
    byName.set(k, list)
  }

  const out: TenderOpportunity[] = records.map((r) => {
    const base = { ...r, customerId: '', customerName: '', customerSalesperson: '', matchNote: '' }
    const exact = byName.get(nameKey(r.unitName)) ?? []
    const stem = customerNameStem(r.unitName)
    const cands = exact.length ? exact : (stem ? (byName.get(nameKey(stem)) ?? []) : [])
    if (cands.length === 0) return { ...base, matchNote: '尚未建檔' }
    if (r.city) {
      const sameCity = cands.filter((c) => tw(c.city) === tw(r.city))
      if (sameCity.length === 1) {
        return { ...base, customerId: sameCity[0].id, customerName: sameCity[0].name,
          customerSalesperson: sameCity[0].salesperson, matchNote: `名稱＋縣市相符：${r.city}` }
      }
      if (sameCity.length > 1) return { ...base, matchNote: `同縣市有 ${sameCity.length} 家同名，未配對` }
      return { ...base, matchNote: '同名客戶不在該縣市，未配對' }
    }
    if (cands.length === 1) {
      return { ...base, customerId: cands[0].id, customerName: cands[0].name,
        customerSalesperson: cands[0].salesperson, matchNote: '名稱唯一相符（無地址可比）' }
    }
    return { ...base, matchNote: `名稱相符 ${cands.length} 家，未配對` }
  })

  const snapshot: TenderSnapshot = {
    records: out, stats, computedAt: new Date().toISOString(), days: options?.days ?? 120,
  }
  await setRedisValue(KEY, snapshot, TTL_MS)
  return snapshot
}

export async function getTenders(): Promise<TenderSnapshot | null> {
  return await getRedisValue<TenderSnapshot>(KEY).catch(() => null)
}
