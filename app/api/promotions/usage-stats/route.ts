/**
 * GET /api/promotions/usage-stats — 各促銷活動帶動的訂單數/金額(依訂單「促銷活動ID」彙總)
 * 供促銷管理頁顯示成效回饋。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getPromotionUsageStats } from '@/lib/orders-notion'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'promotions', action: 'view' }, async () => {
  const stats = await getPromotionUsageStats()
  return NextResponse.json(stats)
})
