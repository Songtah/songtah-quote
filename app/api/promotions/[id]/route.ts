import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPromotionById, updatePromotion, archivePromotion } from '@/lib/promotions-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// GET /api/promotions/[id]
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const promotion = await getPromotionById(params.id)
  if (!promotion) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  return NextResponse.json(promotion)
}

// PUT /api/promotions/[id]
export async function PUT(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
}

// DELETE /api/promotions/[id]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await archivePromotion(params.id)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[DELETE /api/promotions]', err?.message)
    return NextResponse.json({ error: '刪除失敗：' + (err?.message ?? '未知錯誤') }, { status: 500 })
  }
}
