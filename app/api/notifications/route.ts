/**
 * GET /api/notifications —— 登入者的通知（新到舊）、未讀數、推播公鑰（未設定時為空字串，前端就不顯示「開啟推播」）
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { channelsOf, listNotifications, pushPublicKey, pushConfigIssue } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (_req, _ctx, session) => {
  const u = session.user as any
  if (!u?.id) return NextResponse.json({ items: [], unread: 0, pushKey: '' })
  const data = await listNotifications(u.id, channelsOf(u)).catch(() => ({ items: [], unread: 0 }))
  // 推播設定問題只給管理者看（一般帳號看到也沒辦法處理）
  const issue = u.role === 'admin' || u.accountType === '中央管理' ? pushConfigIssue() : ''
  return NextResponse.json({ ...data, pushKey: pushPublicKey(), pushIssue: issue })
})
