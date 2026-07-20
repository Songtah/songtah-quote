/**
 * GET /api/opportunity — 商機偵測檢視(唯讀,clinic_monitor 權限)
 *   ?mode=stats            → 各標籤計數 + 金訊號家數
 *   ?tag=&city=&district=&salesperson=&goldOnly=1 → 客戶名單(金訊號排前)
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOpportunityCustomers, getOpportunityStats } from '@/lib/notion/opportunity'
import { getOpportunityKeywordLibrary } from '@/lib/opportunity-keywords'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = withApiAuth({ module: 'clinic_monitor', action: 'view' }, async (req: NextRequest) => {
  try {
    const sp = req.nextUrl.searchParams
    if (sp.get('mode') === 'stats') {
      const stats = await getOpportunityStats()
      return NextResponse.json(stats)
    }
    const library = await getOpportunityKeywordLibrary()
    const goldTags = library.signals.filter((signal) => signal.gold).map((signal) => signal.tag)
    const items = await listOpportunityCustomers({
      tag: sp.get('tag') || undefined,
      city: sp.get('city') || undefined,
      district: sp.get('district') || undefined,
      salesperson: sp.get('salesperson') || undefined,
      goldOnly: sp.get('goldOnly') === '1',
    })
    return NextResponse.json({ items, goldTags })
  } catch (error) {
    console.error('opportunity GET error:', error)
    return NextResponse.json({ error: '讀取商機資料失敗' }, { status: 500 })
  }
})
