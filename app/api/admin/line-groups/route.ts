/**
 * GET  /api/admin/line-groups —— 公司 LINE 官方帳號所在的群組（ID＋名稱），確認通知對象用。見 lib/line-groups.ts
 * POST /api/admin/line-groups { action: 'test-repair-notify' } —— 發一則維修工單通知的測試訊息到售後服務群組
 */
import { NextRequest, NextResponse } from 'next/server'
import { notifyManager } from '@/lib/visit-repair-tickets'
import { withApiAuth } from '@/lib/api-auth'
import { listLineGroups } from '@/lib/line-groups'
import { isAllowedLineRecipient } from '@/lib/line-push'

export const dynamic = 'force-dynamic'

// 回傳時標出哪個群組是目前環境變數指定的通知對象，方便核對；未標記的群組系統永遠不會主動推播
export const GET = withApiAuth('central-management', async () => {
  const groups = (await listLineGroups()).map((g) => ({
    ...g,
    role: g.groupId === (process.env.TECH_MANAGER_LINE_ID ?? '').trim() ? '維修工單通知'
      : g.groupId === (process.env.LINE_GROUP_ID ?? '').trim() ? '業務日報'
      : isAllowedLineRecipient(g.groupId) ? '白名單' : '',
  }))
  return NextResponse.json({ groups, techManagerConfigured: Boolean((process.env.TECH_MANAGER_LINE_ID ?? '').trim()) })
})

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'test-repair-notify') return NextResponse.json({ error: '不明的動作' }, { status: 400 })
  const sent = await notifyManager('🔧【測試】維修工單通知\n之後業務日報提到維修、系統自動開出「待指派」工單時，會在這個群組通知。\n這則是測試訊息，不需處理。')
  return NextResponse.json({ sent })
})
