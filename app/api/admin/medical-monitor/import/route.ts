/**
 * POST /api/admin/medical-monitor/import
 *
 * 將醫事監控比對結果中的「新開業」匯入到崧達客戶資料庫。
 * Body: { institutions: NewOpening[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createCustomerFromBas } from '@/lib/bas-customer-import'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import type { NewOpening } from '../route'

export const POST = withApiAuth('admin', async (req: NextRequest, _ctx, session) => {
  const body = await req.json()
  const institutions: NewOpening[] = Array.isArray(body.institutions) ? body.institutions : []

  if (institutions.length === 0) {
    return NextResponse.json({ error: '無可匯入的資料' }, { status: 400 })
  }

  const results: { ok: boolean; name: string; id?: string; error?: string }[] = []

  for (const inst of institutions) {
    try {
      // BAS 詳細頁帶入與建檔規則在 lib/bas-customer-import（活動報名自動建檔共用）
      // 自動入開發漏斗：BAS 新開業＝未認領線索
      const created = await createCustomerFromBas(inst, 'BAS新開業')

      await logAuditEvent({
        module:      'crm',
        action:      'create',
        entityType:  'customer',
        entityId:    created.id,
        entityTitle: inst.name,
        summary:     `醫事監控匯入：${inst.name}（${inst.code}）`,
        actor:       getAuditActor(session),
        request:     getAuditRequestContext(req),
        after:       inst,
      }).catch(() => {})

      results.push({ ok: true, name: inst.name, id: created.id })
    } catch (err: any) {
      results.push({ ok: false, name: inst.name, error: err?.message ?? '建立失敗' })
    }
  }

  const created = results.filter(r => r.ok).length
  const errors  = results.filter(r => !r.ok)

  return NextResponse.json({ created, errors, results })
})
