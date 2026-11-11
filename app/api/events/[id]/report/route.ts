/**
 * GET /api/events/[id]/report —— 活動結案報告（參與成果、問卷與滿意度、費用、會後追蹤）。
 * 有活動管理檢視權限即可看；會後報價／訂單的金額只回給中央管理（其餘帳號為 null）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { buildEventReport } from '@/lib/event-report'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'events', action: 'view' }, async (_req: NextRequest, { params }: { params: { id: string } }, session) => {
  const user = session.user as any
  const showAmounts = user?.role === 'admin' || user?.accountType === '中央管理'
  try {
    const report = await buildEventReport(params.id, { showAmounts })
    return report ? NextResponse.json(report) : NextResponse.json({ error: '找不到活動' }, { status: 404 })
  } catch (e: any) {
    console.error('event report error:', e)
    return NextResponse.json({ error: '報告產生失敗，請稍後再試' }, { status: 500 })
  }
})
