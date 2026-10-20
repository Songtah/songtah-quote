/**
 * /api/admin/medical-monitor/visit-closures —— 客情回報歇業的自動更新紀錄
 *   GET                                  最近紀錄（醫事監控頁「客情回報歇業」區塊）
 *   POST { action: 'undo', customerId }  復原：機構狀態改回原值，同一筆客情不再觸發
 * 規則見 lib/visit-closures.ts。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getAuditActor } from '@/lib/audit'
import { listVisitClosures, undoVisitClosure } from '@/lib/visit-closures'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('admin', async () => {
  try {
    return NextResponse.json({ items: await listVisitClosures(50) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '讀取失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth('admin', async (req: NextRequest, _ctx, session) => {
  let body: { action?: string; customerId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: '格式錯誤' }, { status: 400 }) }
  if (body.action !== 'undo' || !body.customerId) return NextResponse.json({ error: '缺少 customerId 或動作不正確' }, { status: 400 })
  try {
    const entry = await undoVisitClosure(body.customerId, getAuditActor(session))
    return NextResponse.json({ ok: true, entry })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '復原失敗' }, { status: 409 })
  }
})
