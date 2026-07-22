import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { listCustomersByArea } from '@/lib/notion/customers'
import {
  createTerritory, listTerritories, TERRITORY_STATUSES,
  type TerritoryStatus,
} from '@/lib/notion/territories'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function clean(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export const GET = withApiAuth({ module: 'clinic_monitor', action: 'view' }, async () => {
  try {
    return NextResponse.json({ items: await listTerritories() })
  } catch (error) {
    console.error('territories GET error:', error)
    return NextResponse.json({ error: '讀取轄區設定失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth({ roles: ['中央管理', '總經理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const city = clean(body.city, 30)
    const district = clean(body.district, 30)
    const salespersonId = clean(body.salespersonId, 80)
    const status = clean(body.status, 20) || '規劃中'
    const startDate = clean(body.startDate, 10)
    const note = clean(body.note, 1000)
    const dryRun = body.dryRun !== false
    if (!city || !district || !salespersonId) {
      return NextResponse.json({ error: '縣市、行政區與負責業務必填' }, { status: 400 })
    }
    if (!TERRITORY_STATUSES.includes(status as TerritoryStatus)) {
      return NextResponse.json({ error: '無效的轄區狀態' }, { status: 400 })
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json({ error: '生效日期格式錯誤' }, { status: 400 })
    }

    const [users, areaCustomers, territories] = await Promise.all([
      getSystemUsers(), listCustomersByArea({ city, district }), listTerritories(),
    ])
    const selectedUser = users.find((user) => user.id === salespersonId && user.status !== '停用' && user.accountType === '業務')
    if (!selectedUser) {
      return NextResponse.json({ error: '負責業務不是有效的啟用帳號' }, { status: 400 })
    }
    if (!canAcceptNewBusiness(selectedUser)) {
      return NextResponse.json({ error: `${selectedUser.name} 目前為「${selectedUser.assignmentMode}」，不可承接新轄區` }, { status: 400 })
    }
    const salesperson = selectedUser.name
    if (areaCustomers.length === 0) {
      return NextResponse.json({ error: '客戶主檔中找不到這個行政區' }, { status: 400 })
    }
    const conflict = territories.find((item) => item.city === city && item.district === district)
    if (conflict) {
      return NextResponse.json({ error: `${city}${district} 已由 ${conflict.salesperson} 負責` }, { status: 409 })
    }
    const activeCustomers = areaCustomers.filter((customer) => !['已歇業', '停業', '撤銷'].includes(customer.status))
    const marketTotal = activeCustomers.length
    const unassigned = activeCustomers.filter((customer) => !customer.salesperson).length
    if (dryRun) {
      return NextResponse.json({ dryRun: true, customerChanges: 0, marketTotal, unassigned })
    }

    const item = await createTerritory({
      city, district, salesperson, salespersonId, status: status as TerritoryStatus,
      startDate: startDate || undefined, note: note || undefined,
      creator: session.user?.name ?? '',
    })
    await logAuditEvent({
      module: 'clinic_monitor', action: 'create', entityType: 'territory',
      entityId: item.id, entityTitle: item.name,
      summary: `建立業務轄區：${city}${district} → ${salesperson}（未修改客戶）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { ...item, customerChanges: 0 },
    }).catch((error) => console.error('audit territory create error:', error))
    return NextResponse.json({ dryRun: false, item, customerChanges: 0 }, { status: 201 })
  } catch (error: any) {
    console.error('territories POST error:', error)
    const conflict = typeof error?.message === 'string' && error.message.includes('已由')
    return NextResponse.json({ error: error?.message || '建立轄區失敗' }, { status: conflict ? 409 : 500 })
  }
})
