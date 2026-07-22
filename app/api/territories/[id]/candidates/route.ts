import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomersByArea } from '@/lib/notion/customers'
import { getTerritory } from '@/lib/notion/territories'
import { TERRITORY_CUSTOMER_TYPES, type TerritoryCustomerType } from '@/lib/territory-areas'
import { canAcceptNewBusiness, getSystemUserById } from '@/lib/notion/accounts'

type Ctx = { params: { id: string } }

function canAccess(session: any, salespersonId: string) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理' ||
    user?.accountType === '總經理' || (!!salespersonId && user?.id === salespersonId)
}

export const GET = withApiAuth<Ctx>({ module: 'clinic_monitor', action: 'view' }, async (req: NextRequest, { params }, session) => {
  try {
    const territory = await getTerritory(params.id)
    if (!canAccess(session, territory.salespersonId)) {
      return NextResponse.json({ error: '只能查看自己的轄區名單' }, { status: 403 })
    }
    if (territory.status === '結束') return NextResponse.json({ error: '轄區已結束' }, { status: 400 })
    const owner = await getSystemUserById(territory.salespersonId).catch(() => null)
    if (!owner || !canAcceptNewBusiness(owner)) {
      return NextResponse.json({ error: `${territory.salesperson} 目前只維護既有客戶，不提供未認領名單` }, { status: 400 })
    }
    const requestedType = req.nextUrl.searchParams.get('type') ?? ''
    const type = TERRITORY_CUSTOMER_TYPES.includes(requestedType as TerritoryCustomerType)
      ? requestedType as TerritoryCustomerType
      : undefined
    const customers = await listCustomersByArea({
      city: territory.city, district: territory.district, unassignedOnly: true, type,
    })
    const items = customers
      .filter((customer) => !['已歇業', '停業', '撤銷'].includes(customer.status))
      .map((customer) => ({
        id: customer.id, name: customer.name, type: customer.type,
        status: customer.status, devStage: customer.devStage,
      }))
    return NextResponse.json({ territory, items })
  } catch (error: any) {
    console.error('territory candidates GET error:', error)
    return NextResponse.json({ error: error?.message || '讀取未開發名單失敗' }, { status: 500 })
  }
})
