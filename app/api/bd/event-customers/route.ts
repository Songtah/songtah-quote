/**
 * GET /api/bd/event-customers —— 業務首頁「課程／活動客戶」
 *
 * 業務：自己負責的＋轄區內無人負責的（「既有客戶維護」模式的業務不承接新客戶，只看自己負責的）。
 * 主管（admin／中央管理／總經理）：全部，含同事負責、無人負責、公司戶；中央管理可直接指派。
 * 列入條件與排序見 lib/event-customers.ts。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listEventCustomers } from '@/lib/event-customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANAGER_TYPES = new Set(['中央管理', '總經理'])

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req: NextRequest, _ctx, session) => {
  try {
    const user = session.user as any
    const manager = user?.role === 'admin' || MANAGER_TYPES.has(user?.accountType ?? '')
    const centralManagement = user?.role === 'admin' || user?.accountType === '中央管理'
    const viewer = session.user?.name?.trim() ?? ''

    let items = await listEventCustomers({ viewer, manager })
    let assignable: string[] = []
    if (!manager) {
      const me = (await getSystemUsers().catch(() => [])).find((u) => u.name === viewer)
      if (!me || !canAcceptNewBusiness(me)) items = items.filter((c) => c.scope === 'mine')
    } else if (centralManagement) {
      assignable = (await getSystemUsers().catch(() => []))
        .filter((u) => u.accountType === '業務' && canAcceptNewBusiness(u))
        .map((u) => u.name).sort((a, b) => a.localeCompare(b, 'zh-TW'))
    }
    // 公司戶調度走 /api/customers/assign-company，權限只限中央管理帳號（admin 角色不含）
    return NextResponse.json({ items, viewingAll: manager, canAssign: centralManagement, canAssignCompany: user?.accountType === '中央管理', assignable })
  } catch (error) {
    console.error('event-customers error:', error)
    return NextResponse.json({ error: '讀取課程客戶失敗' }, { status: 500 })
  }
})
