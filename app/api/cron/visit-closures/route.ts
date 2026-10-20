/**
 * POST /api/cron/visit-closures —— 每晚把客情回報的歇業寫進客戶「機構狀態」
 *
 * 規則與防誤判見 lib/visit-closures.ts。由 GitHub Action 夜間呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 * ?dryRun=1 只回報不寫；?days=N 調整回看天數（預設 14）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runVisitClosureDetection } from '@/lib/visit-closures'

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
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 14, 1), 400)
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
    const r = await runVisitClosureDetection({ days, dryRun })
    return NextResponse.json({
      ok: true, dryRun, days, scanned: r.scanned, detected: r.detected,
      updated: r.updated.map((u) => `${u.customerName}：${u.from || '空白'} → ${u.to}（${u.reporter} ${u.visitDate}）`),
      skipped: r.skipped,
    })
  } catch (error: any) {
    console.error('visit-closures error:', error)
    return NextResponse.json({ error: error?.message ?? '偵測失敗' }, { status: 500 })
  }
}
