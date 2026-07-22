/**
 * POST /api/customers/assign — 轄區重整:把某區「未分派池」分給某業務
 *
 * 權限:限 admin / 中央管理 / 總經理(一般業務不能改分派)。
 * body: { city, district, salesperson, type?, status?, excludeClosed?, excludePersonal?, dryRun? }
 *   - dryRun(預設 true):只回未分派池筆數與樣本,不寫入。
 *   - dryRun=false:實際分派。安全鐵律=只寫「負責業務空白」者(assignSalesperson 逐筆重驗)。
 *
 * 安全:公司/盤商/任何已具名者永不被撈入池、也永不被寫(雙層保護)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomersByArea, assignSalesperson } from '@/lib/notion/customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAIN_TYPES = ['牙醫診所', '牙體技術所', '醫院']

export const POST = withApiAuth({ roles: ['中央管理', '總經理'] }, async (req: NextRequest, _ctx, session) => {
  // roles 檢查放行 accountType∈{中央管理,總經理};admin 亦可(withApiAuth 的 roles 規則對 admin 另判)
  try {
    const b = await req.json()
    const city = (b.city ?? '').trim()
    const district = (b.district ?? '').trim()
    const salesperson = (b.salesperson ?? '').trim()
    if (!city || !district) return NextResponse.json({ error: '缺少縣市/行政區' }, { status: 400 })
    const dryRun = b.dryRun !== false

    if (salesperson) {
      const matches = (await getSystemUsers()).filter((user) => user.name === salesperson)
      if (matches.length !== 1 || !canAcceptNewBusiness(matches[0])) {
        return NextResponse.json({ error: `${salesperson} 目前不承接新客戶` }, { status: 400 })
      }
    }

    // 撈該區未分派池(只含負責業務空白;跟隨類型/狀態篩選讓主管控顆粒度)
    let pool = await listCustomersByArea({
      city, district, unassignedOnly: true,
      type: b.type && b.type !== '其他' ? b.type : undefined,
      status: b.status || undefined,
    })
    if (b.excludeClosed) pool = pool.filter((c) => c.status !== '已歇業')
    if (b.excludePersonal) pool = pool.filter((c) => c.type !== '個人')
    if (b.type === '其他') pool = pool.filter((c) => !MAIN_TYPES.includes(c.type))

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, poolSize: pool.length,
        sample: pool.slice(0, 20).map((c) => ({ name: c.name, type: c.type, status: c.status, phone: c.phone })),
      })
    }

    if (!salesperson) return NextResponse.json({ error: '未選擇要分派的業務' }, { status: 400 })
    if (pool.length === 0) return NextResponse.json({ error: '此範圍已無未分派客戶' }, { status: 400 })

    const { assigned, skipped } = await assignSalesperson(pool.map((c) => c.id), salesperson)

    await logAuditEvent({
      module: 'crm', action: 'update', entityType: 'customer-assignment',
      entityId: `${city}|${district}`,
      summary: `轄區分派:${city}${district} 未分派 ${assigned} 家 → ${salesperson}(跳過 ${skipped.length})`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { city, district, salesperson, assigned, skipped: skipped.length, type: b.type, status: b.status, excludeClosed: !!b.excludeClosed, excludePersonal: !!b.excludePersonal },
    }).catch(() => {})

    return NextResponse.json({ dryRun: false, assigned, skipped: skipped.length, salesperson })
  } catch (error) {
    console.error('assign error:', error)
    return NextResponse.json({ error: '分派失敗' }, { status: 500 })
  }
})
