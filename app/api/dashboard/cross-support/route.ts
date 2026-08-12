/**
 * GET /api/dashboard/cross-support — 老闆儀表板用,跨區支援報備列表
 * 角色比照 /api/dashboard/ceo。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCrossSupportLogs } from '@/lib/notion/cross-support'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ roles: ['行政', '中央管理', '總經理'] }, async (req) => {
  try {
    const from = req.nextUrl.searchParams.get('from') ?? ''
    const to = req.nextUrl.searchParams.get('to') ?? ''
    const logs = await listCrossSupportLogs(from && to ? { from, to } : undefined)
    return NextResponse.json({ logs })
  } catch (error) {
    console.error('dashboard cross-support GET error:', error)
    return NextResponse.json({ error: '讀取跨區支援報備失敗' }, { status: 500 })
  }
})
