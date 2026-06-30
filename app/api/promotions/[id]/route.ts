import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getPromotionById, updatePromotion, archivePromotion } from '@/lib/promotions-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// GET /api/promotions/[id]
export const GET = withApiAuth('session', async (_req: NextRequest, { params }: Ctx) => {
  const promotion = await getPromotionById(params.id)
  if (!promotion) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  return NextResponse.json(promotion)
})

// PUT /api/promotions/[id]  — 僅行政帳號可修改
export const PUT = withApiAuth({ roles: ['行政', '中央管理'] }, async (req: NextRequest, { params }: Ctx) => {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await updatePromotion(params.id, {
      name:        body.name,
      type:        body.type,
      startDate:   body.startDate,
      endDate:     body.endDate,
      description: body.description,
      dmUrl:       body.dmUrl,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[PUT /api/promotions]', err?.message)
    return NextResponse.json({ error: '更新失敗：' + (err?.message ?? '未知錯誤') }, { status: 500 })
  }
})

// DELETE /api/promotions/[id]  — 僅行政帳號可刪除
export const DELETE = withApiAuth({ roles: ['行政', '中央管理'] }, async (_req: NextRequest, { params }: Ctx) => {
  try {
    await archivePromotion(params.id)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[DELETE /api/promotions]', err?.message)
    return NextResponse.json({ error: '刪除失敗：' + (err?.message ?? '未知錯誤') }, { status: 500 })
  }
})
