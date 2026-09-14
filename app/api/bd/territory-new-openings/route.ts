/**
 * GET /api/bd/territory-new-openings —— 轄區新機構（業務個人頁視窗）
 *
 * 業務：只看自己轄區；「既有客戶維護」模式的業務不承接新客戶，一律回空（與認領同一道把關）。
 * 主管（admin／中央管理／總經理）：看全體，含不在任何轄區者；可用 ?salesperson= 指定。
 * 計算見 lib/territory-new-openings.ts。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listTerritoryNewOpenings } from '@/lib/territory-new-openings'
import { canAcceptNewBusiness, getSystemUserById } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANAGER_TYPES = new Set(['中央管理', '總經理'])

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const user = session.user as any
    const manager = user?.role === 'admin' || MANAGER_TYPES.has(user?.accountType ?? '')
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''

    if (!manager) {
      const account = await getSystemUserById(user?.id ?? '').catch(() => null)
      if (!account || !canAcceptNewBusiness(account)) {
        return NextResponse.json({ items: [], viewingAll: false, eligible: false, computedAt: '', snapshotFetched: '' })
      }
    }

    const salesperson = manager ? (requested || undefined) : (session.user?.name ?? '__NO_MATCH__')
    const result = await listTerritoryNewOpenings({ salesperson })
    return NextResponse.json({ ...result, viewingAll: manager && !requested, eligible: true, canImport: manager })
  } catch (error) {
    console.error('territory-new-openings error:', error)
    return NextResponse.json({ error: '讀取轄區新機構失敗' }, { status: 500 })
  }
})
