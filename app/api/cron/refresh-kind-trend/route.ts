/**
 * POST /api/cron/refresh-kind-trend —— 每晚重算市場監控「近半年新增／減少」趨勢與名單
 *
 * 頁面只讀存好的結果（開頁、點長條都不等待）；新月份的監控紀錄與客戶主檔變動靠這支每晚帶進來。
 * 驗證比照其他 cron：x-cron-secret = DAILY_REPORT_SECRET，timing-safe，未設定即拒絕。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getKindTrend } from '@/lib/medical-monitor-trend'

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
    const started = Date.now()
    const t = await getKindTrend({ months: 6, refresh: true })
    return NextResponse.json({
      ok: true,
      months: t.points.length,
      items: t.items.length,
      withoutLink: t.items.filter((i) => !i.basDetailUrl).length,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-kind-trend error:', error)
    return NextResponse.json({ error: error?.message ?? '重算失敗' }, { status: 500 })
  }
}
