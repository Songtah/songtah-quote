/**
 * POST /api/cron/refresh-tenders — 每日重抓政府標案
 * 由 GitHub Action 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe、未設定即失效關閉）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { refreshTenders } from '@/lib/notion/tenders'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const started = Date.now()
    const snap = await refreshTenders()
    return NextResponse.json({
      ok: true,
      records: snap.records.length,
      matched: snap.records.filter((r) => r.customerId).length,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '重抓失敗' }, { status: 500 })
  }
}
