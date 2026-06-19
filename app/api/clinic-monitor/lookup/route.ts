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
import { requireAdmin } from '@/lib/permissions'
import { lookupInstitution, isClosedStatus } from '@/lib/mohw-bas.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  let name = '', code = '', kind: string | undefined
  try {
    const body = await req.json()
    name = (body.name ?? '').toString().trim()
    code = (body.code ?? '').toString().trim()
    kind = body.kind ? String(body.kind) : undefined
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: '缺少機構名稱' }, { status: 400 })

  try {
    const r = await lookupInstitution({ name, kind })

    // 產生建議
    let suggestion: string
    if (!r.found) {
      suggestion = '衛福部查無此名稱，可能已更名或歇業，建議人工至衛福部網站確認。'
    } else if (isClosedStatus(r.status)) {
      suggestion = `衛福部開業狀態為「${r.status}」→ 建議將客戶機構狀態更新為「歇業／停業」。`
    } else if (code && r.code && code !== r.code) {
      suggestion = `衛福部機構代碼為 ${r.code}，與系統現值 ${code} 不同 → 建議將機構代碼更新為 ${r.code}。`
    } else if (!code && r.code) {
      suggestion = `衛福部機構代碼為 ${r.code} → 建議補填至客戶機構代碼。`
    } else {
      suggestion = `衛福部開業狀態「${r.status || '—'}」、機構代碼 ${r.code || '—'} 與系統一致，無需變更。`
    }

    return NextResponse.json({
      found:     r.found,
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
}
