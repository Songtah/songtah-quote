import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemUserById, getSystemUsers } from '@/lib/notion/accounts'
import { listCustomersByArea, listCustomersByAreas } from '@/lib/notion/customers'
import { listTerritories } from '@/lib/notion/territories'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INACTIVE_STATUS = new Set(['已歇業', '停業', '撤銷'])

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const userId = (session.user as any)?.id ?? ''
    if (!/^[0-9a-f]{32}$/i.test(userId.replace(/-/g, ''))) {
      return NextResponse.json({ error: '此清單只提供業務本人查看' }, { status: 403 })
    }
    const account = await getSystemUserById(userId).catch(() => null)
    if (!account || account.accountType !== '業務' || account.status === '停用') {
      return NextResponse.json({ error: '此清單只提供業務本人查看' }, { status: 403 })
    }
    const sameNameAccounts = (await getSystemUsers()).filter((item) =>
      item.accountType === '業務' && item.status !== '停用' && item.name === account.name
    )
    if (sameNameAccounts.length !== 1 || sameNameAccounts[0].id !== account.id) {
      return NextResponse.json({ error: '偵測到同名業務帳號，為保護客戶資料暫停顯示' }, { status: 409 })
    }

    const scope = req.nextUrl.searchParams.get('scope') === 'customers' ? 'customers' : 'territories'
    let customers
    let territoryCount = 0
    if (scope === 'customers') {
      customers = await listCustomersByArea({ salesperson: account.name })
    } else {
      const territories = (await listTerritories()).filter((territory) => territory.salespersonId === account.id)
      territoryCount = territories.length
      customers = (await listCustomersByAreas(territories)).filter((customer) =>
        !customer.salesperson || customer.salesperson === account.name
      )
    }

    const items = customers
      .filter((customer) => !INACTIVE_STATUS.has(customer.status))
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        city: customer.city,
        district: customer.district,
        type: customer.type,
        status: customer.status,
        devStage: customer.devStage,
        salesperson: customer.salesperson,
      }))

    return NextResponse.json({
      scope,
      salesperson: account.name,
      territoryCount,
      items,
    })
  } catch (error) {
    console.error('my-customer-list GET error:', error)
    return NextResponse.json({ error: '讀取客戶清單失敗' }, { status: 500 })
  }
})
