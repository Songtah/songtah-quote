/**
 * POST /api/cron/refresh-visit-suggestions — 每晚重算拜訪建議三張映射(最後拜訪日/設備/訂單)
 *
 * 由 GitHub Action 夜間 curl 呼叫(x-cron-secret: DAILY_REPORT_SECRET,timing-safe)。
 * 讓拜訪建議頁永遠讀 warm 快取;亦可帶正確 secret 手動觸發。
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { refreshSuggestionMaps } from '@/lib/notion/visit-suggestions'

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
    const maps = await refreshSuggestionMaps()
    return NextResponse.json({
      ok: true,
      builtAt: maps.builtAt,
      visitCustomers: Object.keys(maps.visitRecency).length,
      equipmentCustomers: Object.keys(maps.equipmentCounts).length,
      orderCustomers: Object.keys(maps.orderActivity).length,
    })
  } catch (error) {
    console.error('refresh-visit-suggestions error:', error)
    return NextResponse.json({ error: '重算失敗' }, { status: 500 })
  }
}
