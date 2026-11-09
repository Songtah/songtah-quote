/**
 * POST /api/admin/compliance/judge { targetId } —— 以 Claude 判讀該對象尚未判讀的存證頁（中央管理手動觸發）
 * 會產生 API 費用，不掛排程；每次最多 8 頁。結果一律為「疑似」，待人工審核。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { judgeTarget } from '@/lib/compliance/judge'
import { getTarget } from '@/lib/compliance/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 未設定' }, { status: 400 })
    const target = await getTarget(String(body?.targetId ?? ''))
    if (!target) return NextResponse.json({ error: '找不到對象' }, { status: 404 })
    return NextResponse.json({ ok: true, result: await judgeTarget(target) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '判讀失敗' }, { status: 500 })
  }
})
