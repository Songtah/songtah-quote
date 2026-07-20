import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listPromotions, listActivePromotions, createPromotion } from '@/lib/promotions-notion'

export const dynamic = 'force-dynamic'

// GET /api/promotions?active=1
export const GET = withApiAuth('session', async (req: NextRequest) => {
  const activeOnly = req.nextUrl.searchParams.get('active') === '1'
  const list = activeOnly ? await listActivePromotions() : await listPromotions()
  return NextResponse.json(list)
})

// POST /api/promotions  — 僅行政帳號可建立
export const POST = withApiAuth({ roles: ['行政', '中央管理'] }, async (req: NextRequest) => {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body?.name?.trim())
    return NextResponse.json({ error: '請填寫活動名稱' }, { status: 400 })

  try {
    const promotion = await createPromotion({
      name:        body.name.trim(),
      type:        body.type        || undefined,
      startDate:   body.startDate   || undefined,
      endDate:     body.endDate     || undefined,
      description: body.description ?? '',
      dmUrl:       body.dmUrl       || undefined,
      campaignIds: Array.isArray(body.campaignIds) ? body.campaignIds : undefined,
    })
    return NextResponse.json(promotion)
  } catch (err: any) {
    console.error('[POST /api/promotions]', err?.message)
    return NextResponse.json({ error: '建立失敗：' + (err?.message ?? '未知錯誤') }, { status: 500 })
  }
})
