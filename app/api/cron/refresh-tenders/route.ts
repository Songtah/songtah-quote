/**
 * POST /api/cron/refresh-tenders — 每日重抓政府標案
 * 由 GitHub Action 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe、未設定即失效關閉）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { refreshTenders, refreshFromOfficial } from '@/lib/notion/tenders'

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
    const full = req.nextUrl.searchParams.get('full') === '1'
    // ?official=1：改跑官方開放資料補寫（每月一次即可，資料落後兩個月但授權可商用）
    if (req.nextUrl.searchParams.get('official') === '1') {
      const res = await refreshFromOfficial(Number(req.nextUrl.searchParams.get('periods')) || 4)
      return NextResponse.json({ ok: true, mode: 'official', ...res })
    }
    const snap = await refreshTenders({ full })
    // 掃完卻連一則公告都沒有、或最新公告已經是 3 天前 → 上游或排程有問題，回 503 讓排程亮紅燈
    const unhealthy = snap.scannedRecords === 0 || snap.staleDays > 3
    return NextResponse.json({
      ok: true,
      records: snap.records.length,
      matched: snap.records.filter((r) => r.customerId).length,
      scannedDays: snap.scannedDays,
      scannedRecords: snap.scannedRecords,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '重抓失敗' }, { status: 500 })
  }
}
