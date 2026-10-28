/** POST /api/notifications/test —— 傳一則測試通知給自己（確認這台裝置的推播有通） */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { notify, hitRateLimitForUser } from '@/lib/notifications'

export const POST = withApiAuth('session', async (_req, _ctx, session) => {
  const u = session.user as any
  if (!u?.id) return NextResponse.json({ error: '找不到帳號' }, { status: 400 })
  if (await hitRateLimitForUser(u.id)) return NextResponse.json({ error: '測試太頻繁，請稍後再試' }, { status: 429 })
  await notify([`u:${u.id}`], { title: '測試通知', body: '看到這則就代表這台裝置的通知已經開通了', href: '/dashboard' })
  return NextResponse.json({ ok: true })
})
