import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getVisitFormOptions } from '@/lib/system-notion'

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req, _ctx, session) => {
  try {
    const options = await getVisitFormOptions()
    const user = session.user as any
    const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理'
    return NextResponse.json({
      ...options,
      salespersons: canViewAll
        ? options.salespersons
        : (session.user?.name ? [session.user.name] : []),
    })
  } catch {
    return NextResponse.json({ salespersons: [], statuses: [] }, { status: 500 })
  }
})
