/**
 * POST /api/customers/assign-company — 公司既有客戶調度(逐筆):公司 ↔ 業務
 *
 * 權限:僅限「中央管理」帳號(與一般轄區分派的 中央管理/總經理 不同,這裡更嚴)。
 * body: { customerIds: string[], from, to, dryRun? }
 *   - 只允許兩種方向:from='公司' → to=業務(指派);from=業務 → to='公司'(收回)。
 *   - 盤商永不作為 from 或 to(不同通路,鐵板不動)。
 *   - dryRun(預設 true):只回實際會動的筆數,不寫入。
 *
 * 安全鐵律:只改「負責業務仍等於 from」的客戶(reassignSalesperson 逐筆重驗);
 * from 以外的任何客戶一律不碰。逐筆勾選=只動明確指定的 customerIds。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { reassignSalesperson, listCustomersByArea } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const COMPANY = '公司'
const BLOCKED = new Set(['盤商'])

export const POST = withApiAuth({ roles: ['中央管理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const b = await req.json()
    const from = (b.from ?? '').trim()
    const to = (b.to ?? '').trim()
    const customerIds: string[] = Array.isArray(b.customerIds) ? b.customerIds.filter((x: any) => typeof x === 'string' && x) : []
    const dryRun = b.dryRun !== false

    // 只允許 公司 ↔ 業務;盤商一律拒絕;不允許 業務→業務(那是一般轉移的事)
    if (BLOCKED.has(from) || BLOCKED.has(to)) {
      return NextResponse.json({ error: '盤商不開放此調度' }, { status: 400 })
    }
    const isAssign = from === COMPANY && to && to !== COMPANY
    const isCollect = to === COMPANY && from && from !== COMPANY
    if (!isAssign && !isCollect) {
      return NextResponse.json({ error: '只允許「公司→業務」或「業務→公司」' }, { status: 400 })
    }
    if (customerIds.length === 0) {
      return NextResponse.json({ error: '未勾選任何客戶' }, { status: 400 })
    }

    if (dryRun) {
      // 逐筆重驗留給實寫;dryRun 僅回勾選數(實際會跳過非 from 的,實寫回報)
      return NextResponse.json({ dryRun: true, selected: customerIds.length, from, to })
    }

    const { reassigned, skipped } = await reassignSalesperson(customerIds, from, to)

    await logAuditEvent({
      module: 'crm', action: 'update', entityType: 'company-customer-assignment',
      entityId: `${from}→${to}`,
      summary: `公司客戶調度:${from} → ${to},勾選 ${customerIds.length} 家,實際 ${reassigned} 家(跳過 ${skipped.length})`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { from, to, selected: customerIds.length, reassigned, skipped: skipped.length },
    }).catch(() => {})

    return NextResponse.json({ dryRun: false, reassigned, skipped: skipped.length, from, to })
  } catch (error) {
    console.error('assign-company error:', error)
    return NextResponse.json({ error: '調度失敗' }, { status: 500 })
  }
})

// GET:撈某區某來源(公司 或 某業務)的客戶清單供逐筆勾選。限中央管理。
export const GET = withApiAuth({ roles: ['中央管理'] }, async (req: NextRequest) => {
  try {
    const p = req.nextUrl.searchParams
    const city = p.get('city') ?? ''
    const district = p.get('district') ?? ''
    const owner = p.get('owner') ?? '' // '公司' 或 某業務名
    if (!city || !district || !owner) {
      return NextResponse.json({ error: '缺少縣市/行政區/來源' }, { status: 400 })
    }
    if (BLOCKED.has(owner)) return NextResponse.json({ error: '盤商不開放' }, { status: 400 })
    const items = await listCustomersByArea({ city, district, salesperson: owner })
    return NextResponse.json({
      items: items.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status, phone: c.phone })),
    })
  } catch (error) {
    console.error('assign-company list error:', error)
    return NextResponse.json({ error: '讀取清單失敗' }, { status: 500 })
  }
})
