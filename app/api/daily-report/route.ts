/**
 * POST /api/daily-report
 *
 * 產生業務日報並推播至 LINE。
 * Body: { date?: string, period?: 'AM' | 'PM' | 'FULL', preview?: boolean }
 *   - date    預設為今天（台北時間）
 *   - period  預設 FULL；上午場用 AM，下午場用 PM
 *   - preview true 時只回傳文字，不實際推播
 *
 * 也支援 cron secret（X-Cron-Secret header）讓排程服務呼叫。
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildDailyReportData, formatDailyReport, todayTW } from '@/lib/ceo-stats'
import { sendDailyReport } from '@/lib/line-push'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: session 或 cron secret ────────────────────────────
  const cronSecret = process.env.DAILY_REPORT_SECRET
  const headerSecret = req.headers.get('x-cron-secret')

  if (cronSecret && headerSecret === cronSecret) {
    // Cron job — 允許
  } else {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

    const role        = (session.user as any)?.role        as string | undefined
    const accountType = (session.user as any)?.accountType as string | undefined
    const isAdmin = role === 'admin' || accountType === '行政' || accountType === '中央管理'
    if (!isAdmin) return NextResponse.json({ error: '僅行政帳號可傳送日報' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const date    = (body.date    as string | undefined) ?? todayTW()
    const period  = (body.period  as 'AM' | 'PM' | 'FULL' | undefined) ?? 'FULL'
    const preview = Boolean(body.preview)

    // Build report
    const data = await buildDailyReportData(date, period)
    const text = formatDailyReport(data)

    if (preview) {
      return NextResponse.json({ text, visitCount: data.visits.length })
    }

    // Push to LINE
    const result = await sendDailyReport(text)

    return NextResponse.json({
      ok: true,
      message: result,
      date,
      period,
      visitCount: data.visits.length,
    })
  } catch (error: any) {
    console.error('daily-report error:', error)
    return NextResponse.json({ error: error?.message ?? '日報產生失敗' }, { status: 500 })
  }
}

/** GET for quick preview (便於瀏覽器直接測試) */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const p      = req.nextUrl.searchParams
  const date   = p.get('date')   ?? todayTW()
  const period = (p.get('period') ?? 'FULL') as 'AM' | 'PM' | 'FULL'

  const data = await buildDailyReportData(date, period)
  const text = formatDailyReport(data)

  return NextResponse.json({ text, visitCount: data.visits.length, date, period })
}
