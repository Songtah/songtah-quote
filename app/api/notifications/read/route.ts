/** POST /api/notifications/read —— 標記已讀：{ ids: string[] }（只影響自己的已讀狀態） */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { markRead } from '@/lib/notifications'

export const POST = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  const u = session.user as any
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)).slice(0, 100)
    : []
  if (u?.id && ids.length) await markRead(u.id, ids)
  return NextResponse.json({ ok: true })
})
