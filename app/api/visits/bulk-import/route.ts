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
 *   }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createVisit } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json()
    const visits: Array<{ customerName: string; content: string; date: string; salesperson: string }> =
      Array.isArray(body.visits) ? body.visits : []

    if (visits.length === 0) {
      return NextResponse.json({ error: '無可匯入的紀錄' }, { status: 400 })
    }

    const results: { ok: boolean; id?: string; customerName: string; error?: string }[] = []

    // 逐筆建立（Notion rate limit 保護：sequential）
    for (const v of visits) {
      if (!v.customerName?.trim()) {
        results.push({ ok: false, customerName: v.customerName ?? '', error: '客戶名稱為空' })
        continue
      }
      try {
        const visit = await createVisit({
          customerName: v.customerName.trim(),
          date:         v.date,
          salesperson:  v.salesperson ?? '',
          content:      v.content ?? '',
          address:      '',
          city:         '',
          district:     '',
          tags:         [],
          competitorEquipment:  [],
          interestedProductIds: [],
          interactionType:     '',
          interactionPurpose:  '',
          customerReaction:    '',
          followUpAction:      '',
          needsFollowUp:       false,
          nextFollowUpDate:    '',
        })
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
}
