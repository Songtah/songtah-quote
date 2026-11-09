/**
 * POST /api/admin/compliance/capture —— 擷取並存證（中央管理專用）
 *   { targetId }            抓該對象所有自動來源（官網首頁＋內頁）
 *   { targetId, url }       人工貼單篇網址（社群貼文等）；需登入才看得到的頁面會如實回報抓不到
 * GET ?targetId=            該對象的存證清單
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { isSafePublicUrl } from '@/lib/compliance/capture'
import { captureSingleUrl, runCapture } from '@/lib/compliance/check'
import { getTarget, listCaptures } from '@/lib/compliance/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const targetId = req.nextUrl.searchParams.get('targetId') ?? ''
    return NextResponse.json({ captures: (await listCaptures(targetId || undefined)).slice(0, 300) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '讀取失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    const target = await getTarget(String(body?.targetId ?? ''))
    if (!target) return NextResponse.json({ error: '找不到對象' }, { status: 404 })
    if (body?.url) {
      const url = String(body.url).trim()
      if (!isSafePublicUrl(url)) return NextResponse.json({ error: '網址格式不正確' }, { status: 400 })
      return NextResponse.json(await captureSingleUrl(target, String(body?.sourceId ?? ''), url))
    }
    if (!target.sources.some((s) => s.mode === 'auto')) return NextResponse.json({ error: '這個對象沒有可自動擷取的來源（官網）' }, { status: 400 })
    return NextResponse.json({ ok: true, result: await runCapture(target) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '擷取失敗' }, { status: 500 })
  }
})
