import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getPromotionById } from '@/lib/promotions-notion'
import { listItemsByPromotion, createPromotionItem } from '@/lib/promotion-items-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// GET /api/promotions/[id]/items
export const GET = withApiAuth('session', async (_req: NextRequest, { params }: Ctx) => {
  const items = await listItemsByPromotion(params.id)
  return NextResponse.json(items)
})

// POST /api/promotions/[id]/items — 僅行政帳號可新增
export const POST = withApiAuth({ roles: ['行政', '中央管理'] }, async (req: NextRequest, { params }: Ctx) => {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 系列層級品項：skuCode 可為空，但 skuName（或 seriesName）必填
  if (!body?.skuName && !body?.seriesName)
    return NextResponse.json({ error: '缺少商品或系列名稱' }, { status: 400 })

  // Fetch promotion name for denormalization
  const promo = await getPromotionById(params.id)
  if (!promo) return NextResponse.json({ error: '找不到促銷活動' }, { status: 404 })

  try {
    const item = await createPromotionItem({
      promotionId:     params.id,
      promotionName:   promo.name,
      skuCode:         body.skuCode   ?? '',
      skuName:         body.skuName,
      brand:           body.brand     ?? '',
      seriesId:        body.seriesId  ?? '',
      seriesName:      body.seriesName ?? '',
      condition:       body.condition,
      conditionType:   body.conditionType,
      conditionParams: body.conditionParams,
      price:           body.price ?? null,
      adminNote:       body.adminNote,
    })
    return NextResponse.json(item)
  } catch (err: any) {
    console.error('[POST /api/promotions/items]', err?.message)
    return NextResponse.json({ error: '新增失敗：' + (err?.message ?? '') }, { status: 500 })
  }
})
