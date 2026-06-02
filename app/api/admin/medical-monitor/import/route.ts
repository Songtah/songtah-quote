/**
 * POST /api/admin/medical-monitor/import
 *
 * 將醫事監控比對結果中的「新開業」匯入到崧達客戶資料庫。
 * Body: { institutions: NewOpening[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createSystemCustomer } from '@/lib/system-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import type { NewOpening } from '../route'

const KIND_TO_TYPE: Record<string, string> = {
  '牙醫一般診所': '牙醫診所',
  '牙醫診所':     '牙醫診所',
  '牙醫專科診所': '牙醫診所',
  '牙體技術所':   '牙體技術所',
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  const institutions: NewOpening[] = Array.isArray(body.institutions) ? body.institutions : []

  if (institutions.length === 0) {
    return NextResponse.json({ error: '無可匯入的資料' }, { status: 400 })
  }

  const results: { ok: boolean; name: string; id?: string; error?: string }[] = []

  for (const inst of institutions) {
    try {
      const customerType = KIND_TO_TYPE[inst.kind] ?? inst.kind
      const created = await createSystemCustomer({
        name:            inst.name,
        city:            inst.city,
        district:        inst.district,
        address:         inst.address,
        institutionCode: inst.code,
        type:            customerType,
        status:          '開業',
      })

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
}
