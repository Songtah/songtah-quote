/**
 * POST   /api/notifications/push —— 這台裝置開啟推播：{ subscription }（瀏覽器 PushSubscription.toJSON()）
 * DELETE /api/notifications/push —— 這台裝置關閉推播：{ endpoint }
 * 推播網址只接受各大瀏覽器的推播服務網域，避免被拿來讓伺服器打任意網址。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { channelsOf, savePushSubscription, removePushSubscription } from '@/lib/notifications'

const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.apple\.com$/, /\.mozilla\.(com|org)$/, /\.notify\.windows\.com$/, /\.push\.services\.mozilla\.com$/]
const okEndpoint = (s: unknown): s is string => {
  try {
    const u = new URL(String(s))
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname))
  } catch { return false }
}

export const POST = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  const sub = (await req.json().catch(() => ({})))?.subscription
  if (!okEndpoint(sub?.endpoint) || typeof sub?.keys?.p256dh !== 'string' || typeof sub?.keys?.auth !== 'string') {
    return NextResponse.json({ error: '這個瀏覽器的推播資料不正確' }, { status: 400 })
  }
  try {
    await savePushSubscription(channelsOf(session.user as any), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '開啟失敗' }, { status: 503 })
  }
})

export const DELETE = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  const endpoint = (await req.json().catch(() => ({})))?.endpoint
  if (okEndpoint(endpoint)) await removePushSubscription(channelsOf(session.user as any), endpoint)
  return NextResponse.json({ ok: true })
})
