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
import { listTendersNeedingDetail, listTendersNeedingAward, markAwardChecked } from '@/lib/notion/tenders-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 抓取端問「哪些列還缺資料」，好慢慢補（明細頁被官網限流，只能少量多次）
 *   mode=award：缺決標結果（得標廠商、金額）的案子，可用 shard／of 分給多個平行工作
 *   預設    ：缺明細（機關代碼、地址、預算）的案子
 */
export async function GET(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 5, 50)
  if (req.nextUrl.searchParams.get('mode') === 'award') {
    const rows = await listTendersNeedingAward({
      limit,
      shard: Number(req.nextUrl.searchParams.get('shard')) || 0,
      of: Number(req.nextUrl.searchParams.get('of')) || 1,
    })
    return NextResponse.json({
      pending: rows.map((r) => ({
        pageId: r.pageId, unitName: r.unitName, jobNumber: r.jobNumber,
        title: r.title, type: r.type, date: r.date, deadline: r.deadline,
      })),
    })
  }
  const rows = await listTendersNeedingDetail(limit)
  return NextResponse.json({
    pending: rows.map((r) => ({
      url: r.url, unitName: r.unitName, jobNumber: r.jobNumber,
      title: r.title, type: r.type, date: r.date, deadline: r.deadline,
    })),
  })
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const started = Date.now()
    const body = await req.json()
    // 決標查核：即使查不到決標也要記一筆查核日，否則永遠決標不了的案子每輪都會被重查
    const checked: string[] = Array.isArray(body.checkedPageIds) ? body.checkedPageIds.slice(0, 200) : []
    for (const pageId of checked) await markAwardChecked(String(pageId)).catch(() => null)

    const records = Array.isArray(body.records) ? body.records : []
    if (records.length === 0) {
      if (checked.length) return NextResponse.json({ ok: true, checked: checked.length, received: 0 })
      return NextResponse.json({ error: '沒有收到任何標案資料' }, { status: 400 })
    }
    const snap = await ingestTenders(records, {
      ourBidIds: Array.isArray(body.ourBidIds) ? body.ourBidIds : [],
      meta: body.meta ?? {},
    })
    return NextResponse.json({
      ok: true,
      received: records.length,
      checked: checked.length,
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
