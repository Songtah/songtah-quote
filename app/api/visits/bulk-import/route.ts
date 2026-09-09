/**
 * POST /api/visits/bulk-import
 *
 * 批次建立客情紀錄（由業務日報文字解析後呼叫）。
 * Body: {
 *   visits: Array<{
 *     customerName: string
 *     content: string
 *     date: string        // YYYY-MM-DD
 *     salesperson: string
 *     needsFollowUp?: boolean      // 由 line-daily-report 解析器推斷
 *     nextFollowUpDate?: string    // 同上；沒有到期日的追蹤等於沒有追蹤
 *   }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createVisit } from '@/lib/system-notion'
import { advanceCustomerDevStage } from '@/lib/notion/customers'
import { devStageForReaction } from '@/lib/line-daily-report'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const visits: Array<{ customerName: string; content: string; date: string; salesperson: string; customerId?: string; customerReaction?: string; city?: string; district?: string; needsFollowUp?: boolean; nextFollowUpDate?: string }> =
      Array.isArray(body.visits) ? body.visits : []

    if (visits.length === 0) {
      return NextResponse.json({ error: '無可匯入的紀錄' }, { status: 400 })
    }

    const results: { ok: boolean; id?: string; customerName: string; error?: string }[] = []
    const user = session.user as any
    const canImportForOthers = user?.role === 'admin' || user?.accountType === '中央管理'
    const actorName = session.user?.name ?? ''

    // 逐筆建立（Notion rate limit 保護：sequential）
    for (const v of visits) {
      if (!v.customerName?.trim()) {
        results.push({ ok: false, customerName: v.customerName ?? '', error: '客戶名稱為空' })
        continue
      }
      try {
        const visit = await createVisit({
          customerName:     v.customerName.trim(),
          date:             v.date,
          salesperson:      canImportForOthers ? (v.salesperson ?? '') : actorName,
          content:          v.content ?? '',
          customerId:       v.customerId || undefined,
          customerReaction: v.customerReaction || undefined,
          address:          '',
          city:             v.city ?? '',
          district:         v.district ?? '',
          tags:             [],
          competitorEquipment:  [],
          interestedProductIds: [],
          interactionType:      '',
          interactionPurpose:   '',
          followUpAction:       '',
          // 匯入沿用解析器帶來的推斷值；未帶則不標追蹤（不猜）
          needsFollowUp:       v.needsFollowUp === true,
          nextFollowUpDate:    v.needsFollowUp === true ? (v.nextFollowUpDate ?? '') : '',
        })
        // 漏斗由系統推進；別人名下的客戶會 throw，吞掉不影響匯入
        if (v.customerId) {
          await advanceCustomerDevStage(
            v.customerId,
            devStageForReaction(v.customerReaction ?? ''),
            { actorName: canImportForOthers ? (v.salesperson ?? actorName) : actorName, canManageAll: false },
          ).catch(() => false)
        }

        results.push({ ok: true, id: visit.id, customerName: v.customerName })

        await logAuditEvent({
          module:      'bd',
          action:      'create',
          entityType:  'visit',
          entityId:    visit.id,
          entityTitle: visit.customerName,
          summary:     `日報匯入：${visit.customerName}`,
          actor:       getAuditActor(session),
          request:     getAuditRequestContext(req),
          after:       visit,
        }).catch(() => {})
      } catch (err: any) {
        results.push({ ok: false, customerName: v.customerName, error: err?.message ?? '建立失敗' })
      }
    }

    const created = results.filter((r) => r.ok).length
    const errors  = results.filter((r) => !r.ok)

    return NextResponse.json({ created, errors, results })
  } catch (error: any) {
    console.error('bulk-import error:', error)
    return NextResponse.json({ error: error?.message ?? '批次匯入失敗' }, { status: 500 })
  }
})
