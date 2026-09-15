/**
 * POST /api/cron/process-registrations —— 報名自動補活動關聯與客戶配對（每小時）
 *
 * 外掛表單直接寫 Notion、展會簽到不同步配對，兩者都靠這支補齊，業務與行銷都不需手動配對。
 * 驗證比照其他 cron：x-cron-secret = DAILY_REPORT_SECRET，timing-safe，未設定即拒絕。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { processRegistrations } from '@/lib/registration-footprint'

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
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
    const retryUnmatched = req.nextUrl.searchParams.get('retry') === '1'
    return NextResponse.json({ ok: true, dryRun, retryUnmatched, ...(await processRegistrations({ dryRun, retryUnmatched })) })
  } catch (error: any) {
    console.error('process-registrations error:', error)
    return NextResponse.json({ error: error?.message ?? '處理失敗' }, { status: 500 })
  }
}
