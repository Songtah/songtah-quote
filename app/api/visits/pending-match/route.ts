/**
 * /api/visits/pending-match — 待確認配對清單
 *
 * GET            讀夜間排程算好的清單（?refresh=1 才重算，很重，限中央管理）
 * POST confirm   { action:'confirm', visitIds, customerId } 把該組紀錄關聯到指定客戶
 * POST ignore    { action:'ignore', key }                   這組不該配對，不再列出
 * POST unignore  { action:'unignore', key }                 還原
 *
 * 權限：清單會揭露客戶主檔名稱與所在地，且確認等於寫客情關聯，一律限中央管理。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  getPendingMatches, computePendingMatches, confirmPendingMatch,
  ignorePendingMatch, unignorePendingMatch, listIgnoredKeys,
} from '@/lib/notion/pending-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    const groups = refresh ? await computePendingMatches() : await getPendingMatches()
    return NextResponse.json({
      ready: groups !== null,
      groups: groups ?? [],
      ignored: await listIgnoredKeys(),
      totals: groups ? {
        groups: groups.length,
        visits: groups.reduce((n, g) => n + g.count, 0),
        withSuggestion: groups.filter((g) => g.suggestion).length,
        ambiguous: groups.filter((g) => !g.suggestion && g.kind === 'ambiguous').length,
        notFound: groups.filter((g) => g.kind === 'not-found').length,
      } : null,
    })
  } catch (error: any) {
    console.error('pending-match GET error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    if (body.action === 'confirm') {
      const visitIds: string[] = Array.isArray(body.visitIds) ? body.visitIds : []
      const customerId: string = body.customerId ?? ''
      if (!visitIds.length || !customerId) {
        return NextResponse.json({ error: '缺少 visitIds 或 customerId' }, { status: 400 })
      }
      const res = await confirmPendingMatch({ visitIds, customerId })
      return NextResponse.json({ ok: true, ...res })
    }
    if (body.action === 'ignore') {
      if (!body.key) return NextResponse.json({ error: '缺少 key' }, { status: 400 })
      await ignorePendingMatch(String(body.key))
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'unignore') {
      if (!body.key) return NextResponse.json({ error: '缺少 key' }, { status: 400 })
      await unignorePendingMatch(String(body.key))
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: '未知的 action' }, { status: 400 })
  } catch (error: any) {
    console.error('pending-match POST error:', error)
    return NextResponse.json({ error: error?.message ?? '操作失敗' }, { status: 500 })
  }
})
