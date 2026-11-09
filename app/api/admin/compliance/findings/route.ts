/**
 * /api/admin/compliance/findings —— 發現（中央管理專用）
 * GET ?targetId=   列表（附規則標題與條號）
 * PATCH { id, status?, reviewNote?, caseNo?, agency? }   人工審核與案件追蹤
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { RULE_BY_ID } from '@/lib/compliance/rules'
import { type FindingStatus, getFinding, listFindings, saveFinding } from '@/lib/compliance/store'

export const dynamic = 'force-dynamic'
const STATUSES: FindingStatus[] = ['待審', '不成立', '成立', '已產出檢舉書', '已送出', '已結案']

export const GET = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const targetId = req.nextUrl.searchParams.get('targetId') ?? ''
    const findings = (await listFindings(targetId || undefined)).map((f) => {
      const r = RULE_BY_ID.get(f.ruleId)
      return { ...f, ruleTitle: r?.title ?? f.ruleId, ruleLaw: r ? `${r.law}${r.article}` : '', severity: r?.severity ?? '' }
    })
    return NextResponse.json({ findings })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '讀取失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    const f = await getFinding(String(body?.id ?? ''))
    if (!f) return NextResponse.json({ error: '找不到這筆發現' }, { status: 404 })
    if (body?.status !== undefined && !STATUSES.includes(body.status)) return NextResponse.json({ error: '狀態不正確' }, { status: 400 })
    const next = {
      ...f,
      status: (body?.status ?? f.status) as FindingStatus,
      reviewNote: body?.reviewNote !== undefined ? String(body.reviewNote).slice(0, 500) : f.reviewNote,
      caseNo: body?.caseNo !== undefined ? String(body.caseNo).slice(0, 60) : f.caseNo,
      agency: body?.agency !== undefined ? String(body.agency).slice(0, 60) : f.agency,
    }
    await saveFinding(next)
    return NextResponse.json({ ok: true, finding: next })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '寫入失敗' }, { status: 500 })
  }
})
