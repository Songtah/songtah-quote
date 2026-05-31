/**
 * POST /api/daily-report
 *
 * 產生業務日報並推播至 LINE。
 * Body: { date?, period?, salesperson?, text?, preview? }
 *   - date        預設為今天（台北時間）
 *   - period      預設 FULL；上午場用 AM，下午場用 PM
 *   - salesperson 篩選特定業務（留空 = 全部）
 *   - text        若提供則直接推播此文字（不重新產生）
 *   - preview     true 時只回傳文字，不實際推播
 *
 * GET /api/daily-report?period=FULL&date=2024-01-01&salesperson=張三
 *   快速預覽，同時回傳 salespersonNames 供前端下拉
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildDailyReportData, formatDailyReport, todayTW } from '@/lib/ceo-stats'
import { sendDailyReport } from '@/lib/line-push'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: session 或 cron secret ────────────────────────────
  const cronSecret   = process.env.DAILY_REPORT_SECRET
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
    const body        = await req.json().catch(() => ({}))
    const date        = (body.date        as string | undefined)                    ?? todayTW()
    const period      = (body.period      as 'AM' | 'PM' | 'FULL' | undefined)     ?? 'FULL'
    const salesperson = (body.salesperson as string | undefined)                    ?? ''
    const title       = (body.title       as string | undefined)                    ?? ''
    const preview     = Boolean(body.preview)
    const customText  = body.text as string | undefined   // 使用者手動編輯的版本

    // 若前端直接傳入已編輯文字，跳過重新產生
    let text = customText?.trim()
    let visitCount = 0

    if (!text) {
      const data = await buildDailyReportData(date, period, salesperson || undefined)
      text       = formatDailyReport(data, title || undefined)
      visitCount = data.visits.length
    }

    if (preview) {
      return NextResponse.json({ text, visitCount })
    }

    // Push to LINE
    const result = await sendDailyReport(text)

    return NextResponse.json({
      ok: true,
      message: result,
      date,
      period,
      visitCount,
    })
  } catch (error: any) {
    console.error('daily-report error:', error)
    return NextResponse.json({ error: error?.message ?? '日報產生失敗' }, { status: 500 })
  }
}

/** GET — 快速預覽（同時回傳 salespersonNames 供下拉使用） */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const p           = req.nextUrl.searchParams
  const date        = p.get('date')        ?? todayTW()
  const period      = (p.get('period')     ?? 'FULL') as 'AM' | 'PM' | 'FULL'
  const salesperson = p.get('salesperson') ?? ''
  const title       = p.get('title')       ?? ''

  const data = await buildDailyReportData(date, period, salesperson || undefined)
  const text = formatDailyReport(data, title || undefined)

  return NextResponse.json({
    text,
    visitCount:       data.visits.length,
    salespersonNames: data.salespersonNames,
    date,
    period,
  })
}
