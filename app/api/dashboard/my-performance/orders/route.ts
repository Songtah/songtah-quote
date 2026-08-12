/**
 * GET /api/dashboard/my-performance/orders
 *
 * 業務個人訂單明細(含訂購明細品項),供 /dashboard/performance 細項頁使用。
 * 近 6 個月,只查呼叫者自己的訂單——不掃全公司訂單與品項。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOrdersBySalesperson } from '@/lib/orders-notion'

export const dynamic = 'force-dynamic'

function sixMonthRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 8 * 3600_000)
  const to = now.toISOString().slice(0, 10)
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  return { from: from.toISOString().slice(0, 10), to }
}

export const GET = withApiAuth('session', async (_req, _ctx, session) => {
  try {
    const userName = session.user?.name?.trim() ?? ''
    if (!userName) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const orders = await listOrdersBySalesperson(userName, sixMonthRange())
    return NextResponse.json({ orders })
  } catch (error) {
    console.error('my-performance orders GET error:', error)
    return NextResponse.json({ error: '讀取訂單明細失敗' }, { status: 500 })
  }
})
