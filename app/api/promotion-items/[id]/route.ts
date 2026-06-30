import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { updatePromotionItem, deletePromotionItem } from '@/lib/promotion-items-notion'
import type { ItemStatus } from '@/lib/promotion-items-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// PATCH /api/promotion-items/[id] — 僅行政帳號可修改
export const PATCH = withApiAuth({ roles: ['行政', '中央管理'] }, async (req: NextRequest, { params }: Ctx) => {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await updatePromotionItem(params.id, {
      condition:       body.condition,
      conditionType:   body.conditionType,
      conditionParams: body.conditionParams,
      usedQuota:       body.usedQuota,
      price:           body.price,
      status:          body.status as ItemStatus | undefined,
      adminNote:       body.adminNote,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: '更新失敗：' + (err?.message ?? '') }, { status: 500 })
  }
})

// DELETE /api/promotion-items/[id] — 僅行政帳號可刪除
export const DELETE = withApiAuth({ roles: ['行政', '中央管理'] }, async (_req: NextRequest, { params }: Ctx) => {
  try {
    await deletePromotionItem(params.id)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: '刪除失敗：' + (err?.message ?? '') }, { status: 500 })
  }
})
