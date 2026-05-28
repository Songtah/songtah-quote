import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPromotionById } from '@/lib/promotions-notion'
import { listItemsByPromotion, createPromotionItem } from '@/lib/promotion-items-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// GET /api/promotions/[id]/items
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await listItemsByPromotion(params.id)
  return NextResponse.json(items)
}

// POST /api/promotions/[id]/items
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body?.skuCode || !body?.skuName)
    return NextResponse.json({ error: '缺少商品資訊' }, { status: 400 })

  // Fetch promotion name for denormalization
  const promo = await getPromotionById(params.id)
  if (!promo) return NextResponse.json({ error: '找不到促銷活動' }, { status: 404 })

  try {
    const item = await createPromotionItem({
      promotionId:     params.id,
      promotionName:   promo.name,
      skuCode:         body.skuCode,
      skuName:         body.skuName,
      brand:           body.brand ?? '',
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
}
