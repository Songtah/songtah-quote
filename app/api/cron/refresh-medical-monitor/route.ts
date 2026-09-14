/**
 * POST /api/cron/refresh-medical-monitor —— 每晚重算醫事比對結果
 *
 * 原本比對結果只有管理員在市場監控頁手動按「比對」才會更新（快取 TTL 30 天），
 * 業務個人頁的「轄區新機構」若依賴它，就等於要有人先手動操作（違反最高原則）。
 * 客戶庫每天在變（匯入、認領），每晚重算一次讓兩邊都讀到當天的結果。
 * 驗證比照其他 cron：x-cron-secret = DAILY_REPORT_SECRET，timing-safe，未設定即拒絕。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { computeMonitor } from '@/lib/medical-monitor-compare'
import { setCachedMonitorResult } from '@/lib/notion/medical-monitor'

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
    const result = await computeMonitor()
    await setCachedMonitorResult(result)
    const n = result.newOpenings
    return NextResponse.json({
      ok: true,
      newOpenings: n.clinics.length + n.labs.length + n.hospitals.length,
      suspectedClosures: result.stats.suspectedClosures,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-medical-monitor error:', error)
    return NextResponse.json({ error: error?.message ?? '重算失敗' }, { status: 500 })
  }
}
