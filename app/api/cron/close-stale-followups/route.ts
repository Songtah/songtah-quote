/**
 * POST /api/cron/close-stale-followups — 每晚自動結案陳舊的待追蹤
 *
 * 依 CLAUDE.md 自動化鐵則：狀態必須能自己關閉，不可只靠人回頭打勾
 * （實測人工結案率 0.0%）。結案條件是客觀事件，不是猜——見 autoCloseStaleFollowUps。
 * 由 GitHub Action 夜間 curl 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { autoCloseStaleFollowUps } from '@/lib/notion/visits'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false                       // 未設定＝失效關閉
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await autoCloseStaleFollowUps({ dryRun: false })
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    console.error('close-stale-followups error:', error)
    return NextResponse.json({ error: error?.message ?? '自動結案失敗' }, { status: 500 })
  }
}
