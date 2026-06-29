/**
 * POST /api/clinic-monitor/lookup
 *
 * 逐筆即時查衛福部醫事查詢系統（BAS），回機構代碼與開業狀態，並給建議。
 * 用於「資料不一致」「歇業候選」的人工確認（只標示建議，不自動改 CRM）。
 *
 * Body: { name: string, code?: string, kind?: string }
 *   name  客戶/機構名稱（查詢用）
 *   code  系統現有機構代碼（用於比對建議）
 *   kind  機構類別（'2'=牙體技術所、'1'=醫院/診所）；省略則自動嘗試
 *
 * Response:
 *   { found, mohwCode, status, closed, mohwName, address, candidates, suggestion }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { lookupInstitution, isClosedStatus } from '@/lib/mohw-bas.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  let name = '', code = '', customerStatus = '', kind: string | undefined
  try {
    const body = await req.json()
    name = (body.name ?? '').toString().trim()
    code = (body.code ?? '').toString().trim()
    customerStatus = (body.customerStatus ?? '').toString().trim()
    kind = body.kind ? String(body.kind) : undefined
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: '缺少機構名稱' }, { status: 400 })

  try {
    const r = await lookupInstitution({ name, kind })

    // 分類變更形態 + 建議（對齊形態表 6/7/8、5）
    // form: closure(6 真歇業) / recode(7 換照換碼) / unknown(8 查無) / status_mismatch(5) / ok
    let form: 'closure' | 'recode' | 'unknown' | 'status_mismatch' | 'ok'
    let suggestion: string
    if (!r.found) {
      form = 'unknown'
      suggestion = '衛福部查無此名稱，可能已更名或歇業，建議人工至衛福部網站確認。'
    } else if (isClosedStatus(r.status)) {
      form = 'closure'
      suggestion = `衛福部開業狀態為「${r.status}」→ 建議將客戶機構狀態更新為「歇業／停業」。`
    } else if (code && r.code && code !== r.code) {
      form = 'recode'
      suggestion = `機構仍開業但代碼不同（衛福部 ${r.code} ／系統 ${code}）→ 可能換照換碼，建議更新機構代碼為 ${r.code}。`
    } else if (!code && r.code) {
      form = 'recode'
      suggestion = `衛福部機構代碼為 ${r.code} → 建議補填至客戶機構代碼。`
    } else if (customerStatus && isClosedStatus(customerStatus)) {
      // 系統標記停業/歇業，但衛福部顯示開業 → 狀態不符（形態 5）
      form = 'status_mismatch'
      suggestion = `狀態不符：系統「${customerStatus}」、衛福部「${r.status || '開業'}」→ 機構實際仍開業，建議更新客戶機構狀態。`
    } else {
      form = 'ok'
      suggestion = `衛福部開業狀態「${r.status || '—'}」、機構代碼 ${r.code || '—'} 與系統一致，無需變更。`
    }

    return NextResponse.json({
      found:     r.found,
      form,
      mohwCode:  r.code,
      status:    r.status,
      closed:    isClosedStatus(r.status),
      mohwName:  r.name,
      address:   r.address,
      candidates: r.candidates,
      suggestion,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: `查詢衛福部失敗：${e?.message ?? '未知錯誤'}（可能被 WAF 阻擋或逾時，請稍後再試）` },
      { status: 502 }
    )
  }
})
