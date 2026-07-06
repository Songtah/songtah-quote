/**
 * POST /api/cron/refresh-region-stats — 每晚重算區域客戶統計,保持快取新鮮
 *
 * 由 GitHub Action 夜間 curl 呼叫(x-cron-secret: DAILY_REPORT_SECRET,timing-safe)。
 * 讓使用者開頁永遠讀到 warm 快取,不必等 55–60s 全庫掃描。
 * 亦可帶正確 secret 手動觸發。
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getRegionStatsRows } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function timingSafeSecretMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.DAILY_REPORT_SECRET
  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  // 失效關閉:secret 未設定或不符一律拒絕
  if (!cronSecret || !headerSecret || !timingSafeSecretMatch(headerSecret, cronSecret)) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }
  try {
    const { rows, updatedAt } = await getRegionStatsRows(true)
    const total = rows.reduce((s, r) => s + r.count, 0)
    return NextResponse.json({ ok: true, groups: rows.length, total, updatedAt })
  } catch (error) {
    console.error('refresh-region-stats error:', error)
    return NextResponse.json({ error: '重算失敗' }, { status: 500 })
  }
}
