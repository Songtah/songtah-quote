/**
 * POST /api/cron/price-announcement —— 每月 1 日彙整上個月的價格異動並發公告
 * 驗證比照其他 cron：x-cron-secret = DAILY_REPORT_SECRET，timing-safe，未設定即拒絕。
 * ?period=YYYY-MM 可指定月份；?dryRun=1 只回預覽。同一個月只發一次；沒有異動就不發。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { buildAnnouncement, previousPeriodTW } from '@/lib/product-pricing'
import { priceAnnouncementPublished } from '@/lib/notification-events'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('x-cron-secret') ?? ''), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const requested = req.nextUrl.searchParams.get('period') ?? ''
  const period = /^\d{4}-\d{2}$/.test(requested) ? requested : previousPeriodTW()
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  try {
    const { announcement, existing } = await buildAnnouncement(period, { dryRun })
    if (announcement && !existing && !dryRun) {
      const c = announcement.counts
      const summary = [c.newPrice && `新定價 ${c.newPrice}`, c.increase && `調漲 ${c.increase}`, c.decrease && `調降 ${c.decrease}`, c.cleared && `取消定價 ${c.cleared}`].filter(Boolean).join('、')
      priceAnnouncementPublished({ period, total: announcement.rows.length, summary })
    }
    return NextResponse.json({ ok: true, period, dryRun, existing, total: announcement?.rows.length ?? 0, counts: announcement?.counts ?? null })
  } catch (error) {
    console.error('price-announcement error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '處理失敗' }, { status: 500 })
  }
}
