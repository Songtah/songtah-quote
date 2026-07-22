import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import {
  createTerritories, listTerritories, TERRITORY_STATUSES, TerritoryMutationBusyError,
  type TerritoryStatus,
} from '@/lib/notion/territories'
import { getTerritoryAreas } from '@/lib/territory-areas'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function clean(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export const POST = withApiAuth({ roles: ['中央管理', '總經理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const city = clean(body.city, 30)
    const salespersonId = clean(body.salespersonId, 80)
    const districts = Array.from(new Set(
      (Array.isArray(body.districts) ? body.districts : [])
        .map((value: unknown) => clean(value, 30)).filter(Boolean)
    )) as string[]
    const status = clean(body.status, 20) || '規劃中'
    const startDate = clean(body.startDate, 10)
    const note = clean(body.note, 1000)
    const dryRun = body.dryRun !== false
    if (!city || !salespersonId || districts.length === 0) {
      return NextResponse.json({ error: '縣市、行政區與負責業務必填' }, { status: 400 })
    }
    if (districts.length > 30) return NextResponse.json({ error: '單次最多設定 30 個行政區' }, { status: 400 })
    if (!TERRITORY_STATUSES.includes(status as TerritoryStatus)) {
      return NextResponse.json({ error: '無效的轄區狀態' }, { status: 400 })
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json({ error: '生效日期格式錯誤' }, { status: 400 })
    }

    const [users, territories, areaResult] = await Promise.all([
      getSystemUsers(), listTerritories(), getTerritoryAreas(),
    ])
    const selectedUser = users.find((user) =>
      user.id === salespersonId && user.status !== '停用' && user.accountType === '業務'
    )
    if (!selectedUser) return NextResponse.json({ error: '負責業務不是有效的啟用帳號' }, { status: 400 })
    if (!canAcceptNewBusiness(selectedUser)) {
      return NextResponse.json({ error: `${selectedUser.name} 目前為「${selectedUser.assignmentMode}」，不可承接新轄區` }, { status: 400 })
    }

    const areaMap = new Map(areaResult.items.map((area) => [`${area.city}|${area.district}`, area]))
    const occupied = new Map(territories.map((item) => [`${item.city}|${item.district}`, item]))
    const invalid = districts.filter((district) => !areaMap.has(`${city}|${district}`))
    if (invalid.length) return NextResponse.json({ error: `找不到行政區：${invalid.join('、')}` }, { status: 400 })
    const conflicts = districts.flatMap((district) => {
      const hit = occupied.get(`${city}|${district}`)
      return hit ? [{ district, salesperson: hit.salesperson }] : []
    })
    if (conflicts.length) {
      return NextResponse.json({ error: '部分行政區已有負責業務', conflicts }, { status: 409 })
    }

    const preview = districts.map((district) => areaMap.get(`${city}|${district}`)!)
    if (dryRun) {
      return NextResponse.json({
        dryRun: true, customerChanges: 0, districts: preview,
        marketTotal: preview.reduce((sum, area) => sum + area.marketTotal, 0),
      })
    }

    const items = await createTerritories(districts.map((district) => ({
      city, district, salesperson: selectedUser.name, salespersonId,
      status: status as TerritoryStatus, startDate: startDate || undefined,
      note: note || undefined, creator: session.user?.name ?? '',
    })))
    await logAuditEvent({
      module: 'clinic_monitor', action: 'create', entityType: 'territory-batch',
      entityId: items.map((item) => item.id).join(','),
      entityTitle: `${city} ${districts.length} 區`,
      summary: `批次建立業務轄區：${city} ${districts.length} 區 → ${selectedUser.name}（未修改客戶）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { city, districts, salesperson: selectedUser.name, salespersonId, customerChanges: 0 },
    }).catch((error) => console.error('audit territory bulk create error:', error))
    return NextResponse.json({ dryRun: false, items, customerChanges: 0 }, { status: 201 })
  } catch (error: any) {
    console.error('territory bulk POST error:', error)
    if (error instanceof TerritoryMutationBusyError || (typeof error?.message === 'string' && error.message.includes('已由'))) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: error?.message || '批次建立轄區失敗' }, { status: 500 })
  }
})
