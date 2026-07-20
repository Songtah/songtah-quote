import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getOpportunityKeywordLibrary, saveOpportunityKeywordLibrary } from '@/lib/opportunity-keywords'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'clinic_monitor', action: 'view' }, async () => {
  const library = await getOpportunityKeywordLibrary()
  return NextResponse.json(library)
})
export const PUT = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  try {
    const before = await getOpportunityKeywordLibrary()
    const body = await req.json()
    const after = await saveOpportunityKeywordLibrary(body, session.user?.name ?? '')
    await logAuditEvent({
      module: 'clinic_monitor',
      action: 'update',
      entityType: 'opportunity-keywords',
      entityId: 'active-library',
      summary: `更新商機關鍵字庫：${after.signals.length} 組分類`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before: { signals: before.signals },
      after: { signals: after.signals },
    }).catch(() => {})
    return NextResponse.json(after)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '儲存關鍵字庫失敗' }, { status: 400 })
  }
})
