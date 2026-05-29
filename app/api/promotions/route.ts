import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listPromotions, listActivePromotions, createPromotion } from '@/lib/promotions-notion'

export const dynamic = 'force-dynamic'

// GET /api/promotions?active=1
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const activeOnly = req.nextUrl.searchParams.get('active') === '1'
  const list = activeOnly ? await listActivePromotions() : await listPromotions()
  return NextResponse.json(list)
}

// POST /api/promotions  — 僅行政帳號可建立
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user        = session.user as any
  const role        = user?.role        as string | undefined
  const accountType = user?.accountType as string | undefined
  const isAdmin     = role === 'admin' || accountType === '行政' || accountType === '中央管理'
  if (!isAdmin) return NextResponse.json({ error: '僅行政帳號可建立促銷活動' }, { status: 403 })

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
    })
    return NextResponse.json(promotion)
  } catch (err: any) {
    console.error('[POST /api/promotions]', err?.message)
    return NextResponse.json({ error: '建立失敗：' + (err?.message ?? '未知錯誤') }, { status: 500 })
  }
}
