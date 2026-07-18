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
import { listPipelineCustomers, updateCustomerDevStage, DEV_STAGES } from '@/lib/notion/customers'
import { listOpenFollowUps } from '@/lib/notion/visits'
import { listUnclaimedOpportunityLeads } from '@/lib/notion/opportunity'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const GET = withApiAuth('session', async () => {
  try {
    const [customers, followUps, opportunityLeads] = await Promise.all([
      listPipelineCustomers(),
      listOpenFollowUps(),
      listUnclaimedOpportunityLeads().catch((e) => { console.error('bd/pipeline: 商機客戶讀取失敗', e); return [] }),
    ])

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

    const items = customers.map((c) => ({
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

    const result = await updateCustomerDevStage(id, { devStage, salesperson, devSource })

    await logAuditEvent({
      module:      'bd',
      action:      'update',
      entityType:  'customer',
      entityId:    id,
      summary:     `開發漏斗更新：${devStage !== undefined ? `階段→${devStage ?? '(移出)'}` : ''}${
        salesperson ? (result.salespersonSkipped ? ` 認領→${salesperson}(略過,已由 ${result.currentSalesperson} 認領)` : ` 認領→${salesperson}`) : ''
      }`,
      actor:       getAuditActor(session),
      request:     getAuditRequestContext(req),
      after:       { devStage, salesperson },
    }).catch(() => {})

    if (salesperson && result.salespersonSkipped) {
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
