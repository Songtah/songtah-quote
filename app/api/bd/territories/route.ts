import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listTerritories } from '@/lib/notion/territories'
import { getTerritoryAreas } from '@/lib/territory-areas'
import { getSystemUsers } from '@/lib/notion/accounts'
import { getSalespersonAreaBreakdown } from '@/lib/notion/customers'

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
    // 沒有正式轄區(或轄區都已結束)的業務:改用實際客戶分布現算分區統計,取代轄區資料餵給同一套前端。
    const activeTerritories = territories.filter((item) => item.status !== '結束')
    let items: typeof territories = territories
    let areas: { city: string; district: string; marketTotal: number; byType: Record<string, number> }[]
    let areaSource: 'territories' | 'customers' = 'territories'
    if (!canViewAll && activeTerritories.length === 0 && currentAccount?.name) {
      const breakdown = await getSalespersonAreaBreakdown(currentAccount.name)
      areaSource = 'customers'
      areas = breakdown
      items = breakdown.map((area) => ({
        id: '', name: `${area.city}${area.district}｜${currentAccount.name}`,
        city: area.city, district: area.district,
        salesperson: currentAccount.name, salespersonId: currentAccount.id ?? '',
        status: '', startDate: '', note: '', creator: '', createdAt: '',
      }))
    } else {
      const territoryKeys = new Set(territories.map((item) => `${item.city}|${item.district}`))
      areas = areaResult.items.filter((area) => territoryKeys.has(`${area.city}|${area.district}`))
    }
    return NextResponse.json({
      items,
      areas,
      areaSource,
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
