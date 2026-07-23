import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemUserById, getSystemUsers } from '@/lib/notion/accounts'
import { getSystemCustomerById } from '@/lib/notion/customers'
import { canonicalSalespersonName } from '@/lib/salesperson-name'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (
  _req: NextRequest,
  { params }: { params: { id: string } },
  session,
) => {
  try {
    const sessionUser = session.user as any
    const canViewAll = sessionUser?.role === 'admin' || sessionUser?.accountType === '中央管理' || sessionUser?.accountType === '總經理'
    const customer = await getSystemCustomerById(params.id)
    if (!customer) return NextResponse.json({ error: '找不到客戶' }, { status: 404 })

    if (!canViewAll) {
      const userId = sessionUser?.id ?? ''
      if (!/^[0-9a-f]{32}$/i.test(userId.replace(/-/g, ''))) {
        return NextResponse.json({ error: '你沒有此客戶的查看權限' }, { status: 403 })
      }
      const account = await getSystemUserById(userId).catch(() => null)
      if (!account || account.accountType !== '業務' || account.status === '停用') {
        return NextResponse.json({ error: '你沒有此客戶的查看權限' }, { status: 403 })
      }
      const sameNameAccounts = (await getSystemUsers()).filter((item) =>
        item.accountType === '業務' && item.status !== '停用' && item.name === account.name
      )
      if (sameNameAccounts.length !== 1 || sameNameAccounts[0].id !== account.id) {
        return NextResponse.json({ error: '偵測到同名業務帳號，為保護客戶資料暫停顯示' }, { status: 409 })
      }
      if (canonicalSalespersonName(customer.salesperson) !== account.name) {
        return NextResponse.json({ error: '你沒有此客戶的查看權限' }, { status: 403 })
      }
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        city: customer.city,
        district: customer.district,
        type: customer.type,
        status: customer.status,
        address: customer.address,
        phone: customer.phone,
        devStage: customer.devStage,
        salesperson: canonicalSalespersonName(customer.salesperson),
        dentistCount: customer.dentistCount,
        technicianCount: customer.technicianCount,
        technicianTraineeCount: customer.technicianTraineeCount,
      },
      classification: {
        level: '內部機密',
        note: '僅限負責業務與授權主管使用',
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('bd customer detail GET error:', error)
    return NextResponse.json({ error: '讀取客戶詳細資料失敗' }, { status: 500 })
  }
})
