/**
 * GET  /api/admin/line-groups —— 公司 LINE 官方帳號所在的群組（ID＋名稱），確認通知對象用。見 lib/line-groups.ts
 * POST /api/admin/line-groups { action: 'test-repair-notify' } —— 發一則維修工單通知的測試訊息到售後服務群組
 */
import { NextRequest, NextResponse } from 'next/server'
import { notifyManager } from '@/lib/visit-repair-tickets'
import { withApiAuth } from '@/lib/api-auth'
import { listLineGroups } from '@/lib/line-groups'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('central-management', async () => NextResponse.json({ groups: await listLineGroups() }))

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'test-repair-notify') return NextResponse.json({ error: '不明的動作' }, { status: 400 })
  const sent = await notifyManager('🔧【測試】維修工單通知\n之後業務日報提到維修、系統自動開出「待指派」工單時，會在這個群組通知。\n這則是測試訊息，不需處理。')
  return NextResponse.json({ sent })
})
