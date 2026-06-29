/**
 * POST /api/admin/medical-monitor/import
 *
 * 將醫事監控比對結果中的「新開業」匯入到崧達客戶資料庫。
 * Body: { institutions: NewOpening[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createSystemCustomer } from '@/lib/system-notion'
import { fetchBasFull } from '@/lib/mohw-bas.mjs'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import type { NewOpening } from '../route'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const KIND_TO_TYPE: Record<string, string> = {
  '牙醫一般診所': '牙醫診所',
  '牙醫診所':     '牙醫診所',
  '牙醫專科診所': '牙醫診所',
  '牙體技術所':   '牙體技術所',
}

/** 從 bas-cache.json 建 code → { basSeq, zoneSeq } 對照（cache key 為 basSeq__zoneSeq）*/
function loadBasSeqByCode(): Map<string, { basSeq: string; zoneSeq: string }> {
  const map = new Map<string, { basSeq: string; zoneSeq: string }>()
  try {
    const p = path.join(process.cwd(), 'data', 'bas-cache.json')
    if (!existsSync(p)) return map
    const cache = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { code?: string }>
    for (const [key, v] of Object.entries(cache)) {
      if (!v?.code) continue
      const [basSeq, zoneSeq] = key.split('__')
      if (basSeq && zoneSeq) map.set(v.code, { basSeq, zoneSeq })
    }
  } catch { /* 無 cache 則退回只寫基本欄位 */ }
  return map
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const POST = withApiAuth('admin', async (req: NextRequest, _ctx, session) => {
  const body = await req.json()
  const institutions: NewOpening[] = Array.isArray(body.institutions) ? body.institutions : []

  if (institutions.length === 0) {
    return NextResponse.json({ error: '無可匯入的資料' }, { status: 400 })
  }

  const results: { ok: boolean; name: string; id?: string; error?: string }[] = []
  const seqByCode = loadBasSeqByCode()

  for (const inst of institutions) {
    try {
      const customerType = KIND_TO_TYPE[inst.kind] ?? inst.kind

      // 從 BAS 詳細頁帶入完整地址/電話/健保特約 + 三個衛福部連結（依機構代碼查 basSeq/zoneSeq）
      const seq = seqByCode.get(inst.code)
      let full: any = null
      if (seq) {
        try { full = await fetchBasFull(seq); await sleep(200) } catch { full = null }
      }

      const created = await createSystemCustomer({
        name:            inst.name,
        city:            inst.city,
        district:        inst.district,
        address:         full?.address || inst.address,   // 優先用 BAS 完整街道地址
        phone:           full?.phone || undefined,
        institutionCode: inst.code,
        type:            customerType,
        status:          '開業',
        nhiContract:     full ? full.nhi : undefined,
        infoUrl:         full?.infoUrl,
        personnelUrl:    full?.personnelUrl,
        deptUrl:         full?.deptUrl,
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
})
