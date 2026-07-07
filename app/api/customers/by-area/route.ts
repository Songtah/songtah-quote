/**
 * GET /api/customers/by-area — 撈某區某業務的實際客戶清單(區域儀表板彈窗用)
 * query: city, district, salesperson, type, status, devStage(皆選填,filtered query)
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomersByArea } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const p = req.nextUrl.searchParams
    const items = await listCustomersByArea({
      city:        p.get('city') ?? undefined,
      district:    p.get('district') ?? undefined,
      salesperson: p.get('salesperson') ?? undefined,
      type:        p.get('type') ?? undefined,
      status:      p.get('status') ?? undefined,
      devStage:    p.get('devStage') ?? undefined,
    })
    return NextResponse.json({ items })
  } catch (error) {
    console.error('by-area error:', error)
    return NextResponse.json({ error: '讀取客戶清單失敗' }, { status: 500 })
  }
})
