import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { withApiAuth } from '@/lib/api-auth'
import { getCEOStats, lastCeoTimings } from '@/lib/ceo-stats'
import { getRedisValue, setRedisValue } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CEOStats = Awaited<ReturnType<typeof getCEOStats>>
// 跨實例共用（Redis）：先回快取、過期才重算；重算超過等候時間也會在背景跑完存起來，下次開頁就有
const KEY = 'ceo-stats:shared:v1'
const FRESH_MS = 5 * 60_000
const KEEP_MS = 6 * 60 * 60_000
const WAIT_MS = 25_000

export const GET = withApiAuth({ roles: ['行政', '中央管理', '總經理'] }, async (req: NextRequest) => {
  try {
    const timing = req.nextUrl.searchParams.get('timing') === '1'
    const cached = timing ? null : await getRedisValue<{ at: number; v: CEOStats }>(KEY).catch(() => null)
    if (cached && Date.now() - cached.at < FRESH_MS) return NextResponse.json(cached.v)

    const t0 = Date.now()
    const job = getCEOStats().then(async (v) => { await setRedisValue(KEY, { at: Date.now(), v }, KEEP_MS).catch(() => {}); return v })
    waitUntil(job.catch((e) => console.error('CEO dashboard refresh error:', e)))
    if (cached) return NextResponse.json(cached.v)   // 舊資料先用，背景更新

    const result = await Promise.race<CEOStats | null>([job, new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS))])
    if (timing) return NextResponse.json({ totalMs: Date.now() - t0, finished: !!result, parts: lastCeoTimings })
    if (!result) return NextResponse.json({ error: '資料整理中，請稍後重新整理' }, { status: 503 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('CEO dashboard error:', error)
    return NextResponse.json({ error: '無法取得資料' }, { status: 500 })
  }
})
