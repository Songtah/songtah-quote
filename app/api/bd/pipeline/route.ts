/**
 * /api/bd/pipeline — 業務開發漏斗（組合層 route：客戶開發階段 × 跨月待追蹤 × 商機偵測）
 *
 * GET   → 漏斗客戶清單（開發階段非空），每筆附上未結案追蹤數與最近追蹤日；
 *         另附 opportunityLeads：商機偵測掃出但尚未認領、也還沒進漏斗的客戶（見 lib/notion/opportunity.ts）
 * PATCH → { id, devStage?, salesperson?, devSource? } 推進階段／認領（寫入 Notion 客戶主檔）。
 *         salesperson 走零覆蓋防呆（見 updateCustomerDevStage）：已被別人認領時回 salespersonSkipped:true,不覆蓋。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemCustomerById, listPipelineCustomers, updateCustomerDevStage, DEV_STAGES } from '@/lib/notion/customers'
import { listOpenFollowUps } from '@/lib/notion/visits'
import { listUnclaimedOpportunityLeads } from '@/lib/notion/opportunity'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

function canViewAll(session: any) {
  const user = session.user as any
  return user?.role === 'admin' || user?.accountType === '中央管理'
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req, _ctx, session) => {
  try {
    const owner = canViewAll(session) ? undefined : (session.user?.name ?? '__NO_MATCH__')
    const [customers, followUps, opportunityLeads] = await Promise.all([
      listPipelineCustomers(),
      listOpenFollowUps(owner),
      listUnclaimedOpportunityLeads().catch((e) => { console.error('bd/pipeline: 商機客戶讀取失敗', e); return [] }),
    ])
    // 一般業務只看本人名下與尚未認領的開發客戶；已分派給他人的客情屬機密。
    const scopedCustomers = canViewAll(session)
      ? customers
      : customers.filter((customer) => !customer.salesperson || customer.salesperson === owner)

    // 依客戶 relation id 彙總未結案追蹤：筆數 + 最近的下次追蹤日
    const fuByCustomer: Record<string, { count: number; nextDate: string }> = {}
    for (const v of followUps) {
      if (!v.customerId) continue
      const cur = fuByCustomer[v.customerId] ?? { count: 0, nextDate: '' }
      cur.count++
      if (v.nextFollowUpDate && (!cur.nextDate || v.nextFollowUpDate < cur.nextDate)) {
        cur.nextDate = v.nextFollowUpDate
      }
      fuByCustomer[v.customerId] = cur
    }

    const items = scopedCustomers.map((c) => ({
      ...c,
      openFollowUps:    fuByCustomer[c.id]?.count ?? 0,
      nextFollowUpDate: fuByCustomer[c.id]?.nextDate ?? '',
    }))

    return NextResponse.json({ items, stages: DEV_STAGES, opportunityLeads })
  } catch (error) {
    console.error('bd/pipeline GET error:', error)
    return NextResponse.json({ error: '讀取開發漏斗失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const { id, devStage, salesperson, devSource } = body ?? {}
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少客戶 id' }, { status: 400 })
    }
    if (devStage === undefined && !salesperson) {
      return NextResponse.json({ error: '無可更新的欄位' }, { status: 400 })
    }

    const user = session.user as any
    const privileged = canViewAll(session)
    const actorName = session.user?.name ?? ''
    const customer = await getSystemCustomerById(id)
    if (!customer) return NextResponse.json({ error: '找不到客戶' }, { status: 404 })
    if (!privileged && customer.salesperson && customer.salesperson !== actorName) {
      return NextResponse.json({ error: '不可修改其他業務負責的客戶' }, { status: 403 })
    }
    const scopedSalesperson = privileged ? salesperson : actorName
    const result = await updateCustomerDevStage(id, { devStage, salesperson: scopedSalesperson, devSource })

    await logAuditEvent({
      module:      'bd',
      action:      'update',
      entityType:  'customer',
      entityId:    id,
      summary:     `開發漏斗更新：${devStage !== undefined ? `階段→${devStage ?? '(移出)'}` : ''}${
        scopedSalesperson ? (result.salespersonSkipped ? ` 認領→${scopedSalesperson}(略過,已由 ${result.currentSalesperson} 認領)` : ` 認領→${scopedSalesperson}`) : ''
      }`,
      actor:       getAuditActor(session),
      request:     getAuditRequestContext(req),
      after:       { devStage, salesperson: scopedSalesperson },
    }).catch(() => {})

    if (scopedSalesperson && result.salespersonSkipped) {
      return NextResponse.json(
        { ok: true, salespersonSkipped: true, currentSalesperson: result.currentSalesperson, error: `此客戶已由 ${result.currentSalesperson} 認領` },
        { status: 200 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('bd/pipeline PATCH error:', error)
    const msg = typeof error?.message === 'string' ? error.message : ''
    const isValidation = msg.includes('無效的開發階段') || msg.includes('不屬於客戶主檔')
    return NextResponse.json(
      { error: isValidation ? msg : '更新失敗' },
      { status: isValidation ? 400 : 500 }
    )
  }
})
