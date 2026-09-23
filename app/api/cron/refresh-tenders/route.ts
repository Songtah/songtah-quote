/**
 * POST /api/cron/refresh-tenders — 每日重抓政府標案
 * 由 GitHub Action 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe、未設定即失效關閉）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { refreshTenders, refreshFromOfficial } from '@/lib/notion/tenders'
import { searchKeyword } from '@/lib/tender-pcc'

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
    // ?probe=1：只測「正式站能不能連到官網」——頁面上的手動抓取與歷史查詢都走這條路
    if (req.nextUrl.searchParams.get('probe') === '1') {
      const roc = new Date().getFullYear() - 1911
      try {
        const hits = await searchKeyword('牙科', '招標', roc)
        return NextResponse.json({ ok: true, mode: 'probe', hits: hits.length, sample: hits[0]?.title ?? '' })
      } catch (e: any) {
        return NextResponse.json({ ok: false, mode: 'probe', error: e?.message ?? String(e) }, { status: 503 })
      }
    }
    const full = req.nextUrl.searchParams.get('full') === '1'
    // ?official=1：改跑官方開放資料補寫（每月一次即可，資料落後兩個月但授權可商用）
    if (req.nextUrl.searchParams.get('official') === '1') {
      const res = await refreshFromOfficial(Number(req.nextUrl.searchParams.get('periods')) || 4)
      return NextResponse.json({ ok: true, mode: 'official', ...res })
    }
    const snap = await refreshTenders({ full })
    // 查詢全數失敗、或最新公告已是 7 天前 → 來源或排程有問題，回 503 讓排程亮紅燈。
    // （改關鍵字查詢後，候選為 0 有可能只是這幾天真的沒有牙科標案，不算異常）
    const unhealthy = (snap.failedDays > 0 && snap.failedDays >= snap.scannedDays) || snap.staleDays > 7
    return NextResponse.json({
      ok: true,
      records: snap.records.length,
      matched: snap.records.filter((r) => r.customerId).length,
      queries: snap.scannedDays,
      candidates: snap.scannedRecords,
      failedDays: snap.failedDays,
      firstError: snap.firstError,
      latestAnnouncementDate: snap.latestAnnouncementDate,
      staleDays: snap.staleDays,
      elapsedMs: Date.now() - started,
      ...(unhealthy ? { warning: '抓取異常：來源可能未更新或請求被擋' } : {}),
    }, { status: unhealthy ? 503 : 200 })
  } catch (error: any) {
    console.error('refresh-tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '重抓失敗' }, { status: 500 })
  }
}
