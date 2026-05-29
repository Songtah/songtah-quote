import { Redis } from '@upstash/redis'

const KEY = 'products:featured_families'
const TTL = 30 * 24 * 60 * 60 * 1000 // 30 days in ms

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? new Redis({ url, token }) : null
}

export async function getFeaturedFamilyIds(): Promise<string[]> {
  try {
    const r = getRedis()
    if (!r) return []
    const val = await r.get<string[]>(KEY)
    return val ?? []
  } catch { return [] }
}

export async function setFeaturedFamilyIds(ids: string[]): Promise<void> {
  try {
    const r = getRedis()
    if (!r) return
    await r.set(KEY, ids, { px: TTL })
  } catch { /* silent */ }
}
