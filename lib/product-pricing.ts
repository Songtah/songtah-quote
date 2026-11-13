/**
 * lib/product-pricing.ts —— 調價紀錄、批次漲幅計算、每月價格異動公告
 *
 * - 每次售價變動（單筆編輯、定價工作區、批次調價）都寫一筆調價紀錄到 Redis（不設 TTL，是資料不是快取）。
 * - 每月 1 日由排程把上個月的紀錄彙整成「價格異動公告」，存 Redis 並發站內通知；沒有異動就不發。
 * - 售價本身仍只存在 Notion 產品庫「售價」（手動調價），這裡不保存價格的權威值。
 */
import 'server-only'
import { getRedis } from '@/lib/notion/shared'

const CHANGES_KEY = 'product-price-changes'
const ANNOUNCEMENTS_KEY = 'product-price-announcements'

export type PriceChange = {
  code: string
  name: string
  brand: string
  /** 調整前的有效售價（null＝原本待定價） */
  before: number | null
  /** 調整後的有效售價（null＝清除手動調價後回到待定價） */
  after: number | null
  at: number
  actor: string
  /** 單筆編輯／定價工作區／批次漲幅 */
  source: 'edit' | 'workspace' | 'batch'
  note?: string
}

export type PriceAnnouncement = {
  /** 公告月份，例 2026-11（彙整該月的異動） */
  period: string
  createdAt: number
  counts: { newPrice: number; increase: number; decrease: number; cleared: number }
  rows: PriceChange[]
}

export { adjustPrice, type Rounding } from '@/lib/price-rounding'

// ── 調價紀錄 ─────────────────────────────────────────────────
export async function recordPriceChanges(changes: PriceChange[]): Promise<void> {
  const real = changes.filter((change) => change.before !== change.after)
  if (real.length === 0) return
  const redis = getRedis()
  if (!redis) throw new Error('Redis 未設定，無法記錄調價')
  await redis.lpush(CHANGES_KEY, ...real.map((change) => JSON.stringify(change)))
}

function parse<T>(value: unknown): T | null {
  if (value && typeof value === 'object') return value as T
  try { return JSON.parse(String(value)) as T } catch { return null }
}

export async function listPriceChanges(fromMs: number, toMs: number): Promise<PriceChange[]> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis 未設定，無法讀取調價紀錄')
  const out: PriceChange[] = []
  // 新的在前；一頁 500 筆往後讀，讀到早於起點就停
  for (let start = 0; ; start += 500) {
    const page = await redis.lrange(CHANGES_KEY, start, start + 499)
    if (page.length === 0) break
    let older = false
    for (const raw of page) {
      const change = parse<PriceChange>(raw)
      if (!change) continue
      if (change.at < fromMs) { older = true; continue }
      if (change.at < toMs) out.push(change)
    }
    if (older || page.length < 500) break
  }
  return out
}

/** 同一貨號在期間內調了好幾次，只留「期初 → 期末」 */
export function collapseChanges(changes: PriceChange[]): PriceChange[] {
  const byCode = new Map<string, PriceChange>()
  for (const change of [...changes].sort((a, b) => a.at - b.at)) {
    const prev = byCode.get(change.code)
    byCode.set(change.code, prev ? { ...change, before: prev.before } : change)
  }
  return Array.from(byCode.values()).filter((change) => change.before !== change.after)
}

export function countChanges(rows: PriceChange[]): PriceAnnouncement['counts'] {
  const counts = { newPrice: 0, increase: 0, decrease: 0, cleared: 0 }
  for (const row of rows) {
    if (row.before == null && row.after != null) counts.newPrice += 1
    else if (row.after == null) counts.cleared += 1
    else if (row.before != null && row.after > row.before) counts.increase += 1
    else counts.decrease += 1
  }
  return counts
}

// ── 公告 ─────────────────────────────────────────────────────
/** 台灣時間的月份字串與起訖（毫秒） */
export function monthRangeTW(period: string): { from: number; to: number } {
  const [y, m] = period.split('-').map(Number)
  const from = Date.UTC(y, m - 1, 1) - 8 * 3600_000
  const to = Date.UTC(y, m, 1) - 8 * 3600_000
  return { from, to }
}

export function previousPeriodTW(now = Date.now()): string {
  const tw = new Date(now + 8 * 3600_000)
  const d = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function currentPeriodTW(now = Date.now()): string {
  const tw = new Date(now + 8 * 3600_000)
  return `${tw.getUTCFullYear()}-${String(tw.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function listAnnouncements(): Promise<PriceAnnouncement[]> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis 未設定，無法讀取價格公告')
  const all = await redis.hgetall<Record<string, unknown>>(ANNOUNCEMENTS_KEY)
  return Object.values(all ?? {})
    .map((value) => parse<PriceAnnouncement>(value))
    .filter((value): value is PriceAnnouncement => Boolean(value))
    .sort((a, b) => b.period.localeCompare(a.period))
}

/** 建立某月公告；已存在就不重建（回 existing），沒有異動回 null */
export async function buildAnnouncement(period: string, opts: { dryRun?: boolean } = {}): Promise<{ announcement: PriceAnnouncement | null; existing: boolean }> {
  const redis = getRedis()
  if (!redis) throw new Error('Redis 未設定，無法建立價格公告')
  const existingRaw = await redis.hget(ANNOUNCEMENTS_KEY, period)
  if (existingRaw) return { announcement: parse<PriceAnnouncement>(existingRaw), existing: true }
  const { from, to } = monthRangeTW(period)
  const rows = collapseChanges(await listPriceChanges(from, to))
    .sort((a, b) => a.brand.localeCompare(b.brand, 'zh-Hant') || a.code.localeCompare(b.code))
  if (rows.length === 0) return { announcement: null, existing: false }
  const announcement: PriceAnnouncement = { period, createdAt: Date.now(), counts: countChanges(rows), rows }
  if (!opts.dryRun) await redis.hset(ANNOUNCEMENTS_KEY, { [period]: JSON.stringify(announcement) })
  return { announcement, existing: false }
}
