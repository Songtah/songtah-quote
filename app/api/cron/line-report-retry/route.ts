/**
 * POST /api/cron/line-report-retry —— 重試沒跑完的 LINE 日報（每小時）
 *
 * webhook 收到日報先存 Redis 佇列；處理逾時或有筆數建檔失敗的，由這裡重跑（最多 4 次）。
 * 重跑冪等：同業務同日同客戶已有紀錄就略過，不會重複建立。
 * 驗證比照其他 cron：x-cron-secret = DAILY_REPORT_SECRET，timing-safe，未設定即拒絕。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { retryPendingReports } from '@/lib/line-report-ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('x-cron-secret') ?? ''), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { checked, retried } = await retryPendingReports()
    return NextResponse.json({
      ok: true, checked,
      retried: retried.map((r) => ({ salesperson: r.salesperson, status: r.status, attempts: r.attempts, result: r.lastResult, error: r.lastError })),
    })
  } catch (error: any) {
    console.error('line-report-retry error:', error)
    return NextResponse.json({ error: error?.message ?? '重試失敗' }, { status: 500 })
  }
}
