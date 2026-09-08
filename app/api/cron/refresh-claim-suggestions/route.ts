/**
 * POST /api/cron/refresh-claim-suggestions — 每晚重算「待認領建議」
 *
 * 建議是全庫推導（掃拜訪庫 + 客戶庫），太重不能放在請求路徑；
 * 由 GitHub Action 夜間 curl 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 * 比照 refresh-region-stats 的寫法。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { computeClaimSuggestions } from '@/lib/notion/visit-claim'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false                       // 未設定＝失效關閉
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const started = Date.now()
    const items = await computeClaimSuggestions()
    return NextResponse.json({
      ok: true,
      suggestions: items.length,
      looksDeveloping: items.filter((i) => i.looksDeveloping).length,
      contested: items.filter((i) => i.contested).length,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-claim-suggestions error:', error)
    return NextResponse.json({ error: error?.message ?? '重算失敗' }, { status: 500 })
  }
}
