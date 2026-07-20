import fallbackDictionary from '@/data/opportunity-keywords.json'
import { get, list, put } from '@vercel/blob'
import { transientCache } from '@/lib/notion/shared'
import type { OpportunitySignal } from '@/lib/opportunity-signals'

const KEY = 'opportunity:keyword-library:v1'
const BLOB_PATH = 'config/opportunity-keywords.json'
const CACHE_TTL_MS = 120_000

export type OpportunityKeywordLibrary = {
  signals: OpportunitySignal[]
  updatedAt?: string
  updatedBy?: string
}

const fallback: OpportunityKeywordLibrary = {
  signals: fallbackDictionary.signals as OpportunitySignal[],
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

export function validateOpportunityKeywordLibrary(input: unknown): OpportunityKeywordLibrary {
  const raw = input as { signals?: unknown[] }
  if (!Array.isArray(raw?.signals)) throw new Error('關鍵字庫格式錯誤')
  if (raw.signals.length === 0) throw new Error('至少需要一個商機分類')
  if (raw.signals.length > 20) throw new Error('商機分類最多 20 組')

  const seenTags = new Set<string>()
  const signals = raw.signals.map((item, index) => {
    const source = item as Record<string, unknown>
    const tag = cleanText(source.tag, 30)
    if (!tag) throw new Error(`第 ${index + 1} 組缺少分類名稱`)
    if (seenTags.has(tag)) throw new Error(`分類名稱重複：${tag}`)
    seenTags.add(tag)

    const keywords = Array.from(new Set(
      (Array.isArray(source.keywords) ? source.keywords : [])
        .map((value) => cleanText(value, 60))
        .filter(Boolean),
    ))
    if (keywords.length === 0) throw new Error(`${tag} 至少需要一個關鍵字`)
    if (keywords.length > 50) throw new Error(`${tag} 的關鍵字最多 50 個`)

    const productLines = Array.from(new Set(
      (Array.isArray(source.productLines) ? source.productLines : [])
        .map((value) => cleanText(value, 40))
        .filter(Boolean),
    )).slice(0, 20)

    return {
      tag,
      gold: source.gold === true,
      keywords,
      implication: cleanText(source.implication, 240),
      productLines,
    }
  })

  return { signals }
}

export async function getOpportunityKeywordLibrary(): Promise<OpportunityKeywordLibrary> {
  const cached = transientCache.get(KEY)
  if (cached && Date.now() <= cached.expiresAt) return cached.value as OpportunityKeywordLibrary
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return fallback
  try {
    const result = await list({ prefix: BLOB_PATH, limit: 10, token })
    const meta = result.blobs.find((blob) => blob.pathname === BLOB_PATH)
    if (!meta) return fallback
    const blob = await get(meta.url, { access: 'public', token })
    if (!blob) return fallback
    const stored = await new Response(blob.stream).json() as OpportunityKeywordLibrary
    const library = { ...validateOpportunityKeywordLibrary(stored), updatedAt: stored.updatedAt, updatedBy: stored.updatedBy }
    transientCache.set(KEY, { value: library, expiresAt: Date.now() + CACHE_TTL_MS })
    return library
  } catch {
    return fallback
  }
}

export async function saveOpportunityKeywordLibrary(input: unknown, actor: string): Promise<OpportunityKeywordLibrary> {
  const validated = validateOpportunityKeywordLibrary(input)
  const saved = { ...validated, updatedAt: new Date().toISOString(), updatedBy: actor }
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('尚未設定關鍵字庫的持久化儲存')
  const committed = await put(BLOB_PATH, Buffer.from(JSON.stringify(saved)), {
    access: 'public',
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json',
    token,
  })
  const readBack = await get(committed.url, { access: 'public', token })
  if (!readBack) throw new Error('關鍵字庫儲存後無法讀回，已停止套用')
  const verified = await new Response(readBack.stream).json()
  validateOpportunityKeywordLibrary(verified)
  transientCache.set(KEY, { value: saved, expiresAt: Date.now() + CACHE_TTL_MS })
  return saved
}
