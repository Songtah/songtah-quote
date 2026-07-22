import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { claimTerritoryCustomers } from '@/lib/notion/customers'
import { getTerritory } from '@/lib/notion/territories'
import { canAcceptNewBusiness, getSystemUserById } from '@/lib/notion/accounts'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const maxDuration = 300
type Ctx = { params: { id: string } }

function canAccess(session: any, salespersonId: string) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理' ||
    user?.accountType === '總經理' || (!!salespersonId && user?.id === salespersonId)
}

export const POST = withApiAuth<Ctx>({ module: 'clinic_monitor', action: 'edit' }, async (req: NextRequest, { params }, session) => {
  try {
    const territory = await getTerritory(params.id)
    if (!canAccess(session, territory.salespersonId)) {
      return NextResponse.json({ error: '只能認領自己轄區的客戶' }, { status: 403 })
    }
    if (territory.status === '暫停' || territory.status === '結束') {
      return NextResponse.json({ error: `轄區目前為「${territory.status}」，不可認領` }, { status: 400 })
    }
    const owner = await getSystemUserById(territory.salespersonId).catch(() => null)
    if (!owner || !canAcceptNewBusiness(owner)) {
      return NextResponse.json({ error: `${territory.salesperson} 目前只維護既有客戶，不可認領新客戶` }, { status: 400 })
    }
    const body = await req.json()
    const customerIds = Array.isArray(body.customerIds)
      ? body.customerIds.filter((id: unknown): id is string => typeof id === 'string' && !!id)
      : []
    if (customerIds.length === 0) return NextResponse.json({ error: '尚未勾選客戶' }, { status: 400 })
    if (customerIds.length > 100) return NextResponse.json({ error: '單次最多認領 100 家' }, { status: 400 })
    const dryRun = body.dryRun !== false
    const result = await claimTerritoryCustomers(customerIds, {
      city: territory.city, district: territory.district,
    }, territory.salesperson, dryRun)
    if (!dryRun) {
      await logAuditEvent({
        module: 'clinic_monitor', action: 'update', entityType: 'territory-claim',
        entityId: territory.id, entityTitle: territory.name,
        summary: `${territory.salesperson} 從 ${territory.city}${territory.district} 認領 ${result.claimed} 家客戶`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { selected: customerIds.length, claimed: result.claimed, skipped: result.skipped },
      }).catch((error) => console.error('audit territory claim error:', error))
    }
    return NextResponse.json({ dryRun, ...result })
  } catch (error: any) {
    console.error('territory claim POST error:', error)
    return NextResponse.json({ error: error?.message || '認領客戶失敗' }, { status: 500 })
  }
})
