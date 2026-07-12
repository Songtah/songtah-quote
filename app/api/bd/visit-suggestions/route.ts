/**
 * GET /api/bd/visit-suggestions — 拜訪建議(組合層 route)
 *
 * 參數:city、district(必填)、salesperson(預設登入者名稱)、target(日量,預設8)、bcap(B類上限,預設4)
 * 回傳 A(商品興趣追蹤)/B(例行拜訪)/C(陌生開發)三組建議與理由。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { buildVisitSuggestions } from '@/lib/notion/visit-suggestions'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  try {
    const sp = req.nextUrl.searchParams
    const city = sp.get('city') ?? ''
    const district = sp.get('district') ?? ''
    if (!city || !district) {
      return NextResponse.json({ error: '請指定縣市與鄉鎮市區' }, { status: 400 })
    }
    const salesperson = sp.get('salesperson') || (session?.user?.name ?? '')
    if (!salesperson) {
      return NextResponse.json({ error: '請指定業務' }, { status: 400 })
    }
    const target = Math.min(30, Math.max(1, Number(sp.get('target')) || 8))
    const bCap = Math.min(30, Math.max(0, Number(sp.get('bcap')) || 4))

    const result = await buildVisitSuggestions({ city, district, salesperson, target, bCap })
    return NextResponse.json(result)
  } catch (error) {
    console.error('visit-suggestions error:', error)
    return NextResponse.json({ error: '產生拜訪建議失敗' }, { status: 500 })
  }
})
