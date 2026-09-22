/**
 * POST /api/cron/ingest-tenders — 接收 GitHub Action 抓好的標案並寫入系統
 *
 * 為什麼要有這支：上游（政府電子採購網資料 API）對 Vercel 的伺服器 IP 一律回 403，
 * 實測補上瀏覽器標頭仍被擋，但本機與 GitHub Action runner 都正常。
 * 因此抓取移到 Action 端，這支只負責「比對客戶 → upsert Notion → 重建快取」。
 * 認證與其他排程一致：x-cron-secret（timing-safe、未設定即失效關閉）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { ingestTenders } from '@/lib/notion/tenders'

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
    const body = await req.json()
    const records = Array.isArray(body.records) ? body.records : []
    if (records.length === 0) {
      return NextResponse.json({ error: '沒有收到任何標案資料' }, { status: 400 })
    }
    const snap = await ingestTenders(records, {
      ourBidIds: Array.isArray(body.ourBidIds) ? body.ourBidIds : [],
      meta: body.meta ?? {},
    })
    return NextResponse.json({
      ok: true,
      received: records.length,
      inDb: snap.records.length,
      matched: snap.records.filter((r) => r.customerId).length,
      latestAnnouncementDate: snap.latestAnnouncementDate,
      staleDays: snap.staleDays,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('ingest-tenders error:', error)
    return NextResponse.json({ error: error?.message ?? '寫入失敗' }, { status: 500 })
  }
}
