/**
 * POST /api/cron/refresh-claim-suggestions — 每晚重算「待認領建議」
 *
 * 建議是全庫推導（掃拜訪庫 + 客戶庫），太重不能放在請求路徑；
 * 由 GitHub Action 夜間 curl 呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 * 比照 refresh-region-stats 的寫法。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { computeClaimSuggestions } from '@/lib/notion/visit-claim'
import { rebuildMatchContext } from '@/lib/notion/match-context'
import { computePendingMatches, getLastAutoLinked } from '@/lib/notion/pending-match'

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
    const started = Date.now()
    const items = await computeClaimSuggestions()
    // 順便重算名稱比對的消歧義脈絡（轄區／活動縣市／歷史往來）——同樣是全掃推導，
    // 併在這支排程避免多跑一次全庫掃描。失敗不影響建議重算。
    const ctx = await rebuildMatchContext().catch((e) => {
      console.error('rebuildMatchContext error:', e)
      return null
    })
    // 待確認配對清單：脈絡重算完才算，順序不能顛倒（清單要用新脈絡判斷）
    const pending = ctx ? await computePendingMatches().catch((e) => {
      console.error('computePendingMatches error:', e)
      return null
    }) : null
    return NextResponse.json({
      ok: true,
      suggestions: items.length,
      pendingMatch: pending ? { 自動補上關聯: getLastAutoLinked(), 組數: pending.length, 筆數: pending.reduce((n, g) => n + g.count, 0) } : 'skipped',
      matchContext: ctx ? { 業務數: ctx.visitedBy.size, 有轄區: ctx.territoriesBy.size } : 'failed',
      looksDeveloping: items.filter((i) => i.looksDeveloping).length,
      contested: items.filter((i) => i.contested).length,
      elapsedMs: Date.now() - started,
    })
  } catch (error: any) {
    console.error('refresh-claim-suggestions error:', error)
    return NextResponse.json({ error: error?.message ?? '重算失敗' }, { status: 500 })
  }
}
