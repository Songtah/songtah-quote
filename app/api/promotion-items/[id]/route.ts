import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updatePromotionItem, deletePromotionItem } from '@/lib/promotion-items-notion'
import type { ItemStatus } from '@/lib/promotion-items-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// PATCH /api/promotion-items/[id]
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await updatePromotionItem(params.id, {
      condition:  body.condition,
      price:      body.price,
      status:     body.status as ItemStatus | undefined,
      adminNote:  body.adminNote,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: '更新失敗：' + (err?.message ?? '') }, { status: 500 })
  }
}

// DELETE /api/promotion-items/[id]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await deletePromotionItem(params.id)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: '刪除失敗：' + (err?.message ?? '') }, { status: 500 })
  }
}
