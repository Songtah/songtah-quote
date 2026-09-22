/**
 * /api/admin/medical-monitor/dismiss — 排除異常（略過）
 *
 * GET           列出目前排除清單
 * POST dismiss  { action:'dismiss', category, customerId, customerName, institutionCode, reason }
 * POST restore  { action:'restore', key }
 *
 * 排除只影響監控頁的顯示與統計，不寫客戶主檔。
 * 排除鍵含當下機構代碼，代碼變動（換照、補正）後該筆會自動重新出現。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { withApiAuth } from '@/lib/api-auth'
import {
  listDismissed, dismissMonitorItem, restoreMonitorItem,
  type MonitorDismissCategory,
} from '@/lib/notion/monitor-dismiss'
import { invalidateMonitorResultCache } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'

const CATEGORIES: MonitorDismissCategory[] = [
  'closure', 'codechange', 'hospital', 'inconsistent', 'invalidcode', 'samecity', 'unregistered', 'reopen',
]

export const GET = withApiAuth('admin', async () => {
  return NextResponse.json({ items: await listDismissed() })
})

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    if (body.action === 'restore') {
      if (!body.key) return NextResponse.json({ error: '缺少 key' }, { status: 400 })
      await restoreMonitorItem(String(body.key))
      await invalidateMonitorResultCache()
      return NextResponse.json({ ok: true })
    }
    const category = String(body.category ?? '') as MonitorDismissCategory
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: '未知的類別' }, { status: 400 })
    }
    if (!body.customerId) return NextResponse.json({ error: '缺少 customerId' }, { status: 400 })
    const session = await getServerSession(authOptions)
    const entry = await dismissMonitorItem({
      category,
      customerId: String(body.customerId),
      customerName: String(body.customerName ?? ''),
      institutionCode: String(body.institutionCode ?? ''),
      reason: String(body.reason ?? '').slice(0, 200),
      by: session?.user?.name ?? '未知',
    })
    // 下次開頁要看到已排除的結果，不能繼續回舊快取
    await invalidateMonitorResultCache()
    return NextResponse.json({ ok: true, entry })
  } catch (error: any) {
    console.error('monitor dismiss error:', error)
    return NextResponse.json({ error: error?.message ?? '操作失敗' }, { status: 500 })
  }
})
