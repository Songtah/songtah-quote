import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listTerritories } from '@/lib/notion/territories'
import { getTerritoryAreas } from '@/lib/territory-areas'
import { getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req, _ctx, session) => {
  try {
    const user = session.user as any
    const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'
    const [allTerritories, areaResult, users] = await Promise.all([listTerritories(), getTerritoryAreas(), getSystemUsers()])
    const currentAccount = users.find((item) => item.id === user?.id)
    const territories = canViewAll
      ? allTerritories
      : allTerritories.filter((item) => !!item.salespersonId && item.salespersonId === user?.id)
    const territoryKeys = new Set(territories.map((item) => `${item.city}|${item.district}`))
    const areas = areaResult.items.filter((area) => territoryKeys.has(`${area.city}|${area.district}`))
    return NextResponse.json({
      items: territories,
      areas,
      updatedAt: areaResult.updatedAt,
      scope: canViewAll ? 'team' : 'mine',
      assignmentMode: currentAccount?.assignmentMode ?? '全面開發',
      accountId: currentAccount?.id ?? '',
    })
  } catch (error) {
    console.error('bd territories GET error:', error)
    return NextResponse.json({ error: '讀取我的轄區失敗' }, { status: 500 })
  }
})
