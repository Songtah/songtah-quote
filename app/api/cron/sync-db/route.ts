/**
 * POST /api/cron/sync-db — Notion → Supabase 同步。預設全量（每晚）；?mode=incremental&since=30 只同步最近 N 分鐘有改動的頁面（每 15 分鐘）。
 * 由 GitHub Action 夜間 curl 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 * 結果寫入 sync_runs，中央管理在 /settings/db-sync 檢視；不發任何推播。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { hasDb } from '@/lib/db/client'
import { syncFromNotion } from '@/lib/db/sync-notion'

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
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL 未設定' }, { status: 503 })
  try {
    const mode = req.nextUrl.searchParams.get('mode') === 'incremental' ? 'incremental' : 'full'
    const sinceMinutes = Math.min(Math.max(Number(req.nextUrl.searchParams.get('since') ?? 30) || 30, 5), 1440)
    const result = await syncFromNotion({ mode, sinceMinutes })
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    console.error('sync-db error:', error)
    return NextResponse.json({ error: error?.message ?? '同步失敗' }, { status: 500 })
  }
}
