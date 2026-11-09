/**
 * POST /api/admin/compliance/report { targetId } —— 以該對象所有「成立」的發現產出檢舉書文字（中央管理專用）
 * 只產出文字與證據清單，由本人審核後自行送到受理機關；系統不代送。產出後把這些發現標為「已產出檢舉書」。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { buildReport } from '@/lib/compliance/report'
import { getTarget, listCaptures, listFindings, saveFinding } from '@/lib/compliance/store'

export const dynamic = 'force-dynamic'

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    const target = await getTarget(String(body?.targetId ?? ''))
    if (!target) return NextResponse.json({ error: '找不到對象' }, { status: 404 })
    const findings = (await listFindings(target.id)).filter((f) => f.status === '成立' || f.status === '已產出檢舉書')
    if (!findings.length) return NextResponse.json({ error: '沒有標為「成立」的發現。請先逐筆審核。' }, { status: 400 })
    const captures = new Map((await listCaptures(target.id)).map((c) => [c.id, c]))
    const pkg = buildReport(target, findings, captures)
    for (const f of findings) if (f.status === '成立') await saveFinding({ ...f, status: '已產出檢舉書', agency: f.agency || pkg.agency })
    return NextResponse.json({ ok: true, report: pkg, count: findings.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '產出失敗' }, { status: 500 })
  }
})
