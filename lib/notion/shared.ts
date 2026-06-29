/**
 * lib/notion/shared.ts — Notion 資料層共用基礎（leaf module，不可 import 任何 domain 檔）
 *
 * 從 system-notion.ts 抽出的共用基礎設施：Notion client、雙層快取（L1 記憶體 + L2 Redis）、
 * DB id 對照表、Notion property 讀取 helper、限流重試。各領域檔（customers/visits/...）
 * 一律從這裡 import，system-notion.ts 則 re-export 之以維持既有 import 路徑相容。
 */
import { Client } from '@notionhq/client'
import { Redis } from '@upstash/redis'

export const notion = new Client({ auth: process.env.NOTION_TOKEN })

// ── In-memory cache (L1) ─────────────────────────────────────────────────────
// Fast but resets on every Vercel cold start.
export const transientCache = new Map<string, { expiresAt: number; value: unknown }>()

// ── Redis cache (L2 — Upstash) ────────────────────────────────────────────────
// Persists across cold starts and serverless instances.
let _redis: Redis | null | undefined = undefined

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  _redis = url && token ? new Redis({ url, token }) : null
  return _redis
}

/** Read from L1 first, then L2. On L2 hit, refreshes L1 for 2 min. */
export async function getRedisValue<T>(key: string): Promise<T | null> {
  const hit = transientCache.get(key)
  if (hit && Date.now() <= hit.expiresAt) return hit.value as T

  const r = getRedis()
  if (!r) return null
  try {
    const value = await r.get<T>(key)
    if (value !== null && value !== undefined) {
      transientCache.set(key, { value, expiresAt: Date.now() + 120_000 })
    }
    return value ?? null
  } catch (e) {
    console.warn(`[redis] get "${key}" failed:`, e)
    return null
  }
}

/** Write to both L1 and L2. TTL in milliseconds. */
export async function setRedisValue<T>(key: string, value: T, ttlMs: number): Promise<void> {
  transientCache.set(key, { value, expiresAt: Date.now() + ttlMs })
  const r = getRedis()
  if (!r) return
  try {
    await r.set(key, value, { px: ttlMs })
  } catch (e) {
    console.warn(`[redis] set "${key}" failed:`, e)
  }
}

/** Delete from both L1 and L2 (fire-and-forget for L2). */
export function deleteRedisValue(key: string): void {
  transientCache.delete(key)
  const r = getRedis()
  if (r) r.del(key).catch((e) => console.warn(`[redis] del "${key}" failed:`, e))
}

export const DB = {
  customers: process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? process.env.NOTION_CUSTOMERS_DB,
  events: process.env.NOTION_EVENTS_DB,
  registrations: process.env.NOTION_REGISTRATIONS_DB,
  course_costs: process.env.NOTION_COURSE_COSTS_DB,
  visits: process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16',
  tickets:
    process.env.NOTION_TICKETS_SYSTEM_DB ??
    process.env.NOTION_TICKETS_DB ??
    '285dcdaa-fb2a-81d9-b434-f8c5c43d006b',
  opportunities:
    process.env.NOTION_OPPORTUNITIES_SYSTEM_DB ??
    process.env.NOTION_OPPORTUNITIES_DB ??
    'b1d7283f-d48c-49c3-836e-e6a6c0dab177',
  products: process.env.NOTION_PRODUCTS_SYSTEM_DB ?? process.env.NOTION_PRODUCTS_DB,
  users:
    process.env.NOTION_USERS_SYSTEM_DB ??
    process.env.NOTION_USERS_DB ??
    '24128750-c5eb-461c-b3db-20994ae14391',
  equipment:
    process.env.NOTION_EQUIPMENT_SYSTEM_DB ??
    process.env.NOTION_EQUIPMENT_DB ??
    '285dcdaa-fb2a-812d-a5ab-eb34d8008d43',
  // 醫事數量趨勢（每月一列；醫事監控儀表板的永久紀錄）
  medicalTrend:
    process.env.NOTION_MEDICAL_TREND_DB ??
    '386dcdaa-fb2a-818f-8c11-d24e88b111b3',
  // 診所監控紀錄（月排程寫入的逐筆異動：新開業/新增停業/停業/恢復開業）
  monitor: process.env.NOTION_CLINIC_MONITOR_DB,
} as const

export function normalizeDatabaseId(value?: string) {
  if (!value) return ''
  return value.replace('collection://', '')
}

export function getProp(page: any, field: string) {
  return page.properties?.[field]
}

export function getTitle(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'title') {
    return prop.title?.map((item: any) => item.plain_text).join('') ?? ''
  }
  if (prop.type === 'rich_text') {
    return prop.rich_text?.map((item: any) => item.plain_text).join('') ?? ''
  }
  return ''
}

export function getText(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'rich_text') {
    return prop.rich_text?.map((item: any) => item.plain_text).join('') ?? ''
  }
  if (prop.type === 'email') return prop.email ?? ''
  if (prop.type === 'phone_number') return prop.phone_number ?? ''
  return ''
}

export function getSelect(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop) return ''
  if (prop.type === 'select') return prop.select?.name ?? ''
  if (prop.type === 'status') return prop.status?.name ?? ''
  return ''
}

export function getNumber(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'number') return 0
  return prop.number ?? 0
}

export function getDate(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'date') return ''
  return prop.date?.start ?? ''
}

export function getRelationIds(page: any, field: string) {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'relation') return [] as string[]
  return (prop.relation ?? []).map((item: any) => item.id).filter(Boolean)
}

export function getRollupText(page: any, field: string): string {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'rollup') return ''
  const arr: any[] = prop.rollup?.array ?? []
  return arr
    .map((item: any) => {
      if (item.type === 'rich_text') return item.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
      if (item.type === 'select') return item.select?.name ?? ''
      if (item.type === 'title') return item.title?.map((t: any) => t.plain_text).join('') ?? ''
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

export function richText(content: string) {
  return [{ type: 'text', text: { content } }]
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRateLimited(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; status?: number; body?: { code?: string } }
  return (
    maybeError.code === 'rate_limited' ||
    maybeError.status === 429 ||
    maybeError.body?.code === 'rate_limited'
  )
}

export async function notionCallWithRetry<T>(
  label: string,
  action: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (!isRateLimited(error) || attempt === maxAttempts) {
        throw error
      }
      const delayMs = attempt * 1200
      console.warn(`${label} rate limited, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`)
      await sleep(delayMs)
    }
  }
  throw lastError
}

export function getCachedValue<T>(key: string) {
  const hit = transientCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    transientCache.delete(key)
    return null
  }
  return hit.value as T
}

export function setCachedValue<T>(key: string, value: T, ttlMs: number) {
  transientCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** 取單一 DB 第一頁（供摘要/輕量列表用）。客戶與儀表板彙總共用，故置於 shared。 */
export async function querySummary(databaseId: string | undefined, pageSize = 100): Promise<{ rows: any[]; total: number; hasMore: boolean }> {
  if (!databaseId) return { rows: [], total: 0, hasMore: false }
  const firstPage: any = await notionCallWithRetry('querySummary', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(databaseId),
      page_size: pageSize,
    })
  )
  const rows = firstPage.results ?? []
  const hasMore = firstPage.has_more ?? false
  return { rows, total: rows.length, hasMore }
}
