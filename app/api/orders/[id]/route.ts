import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getOrderById, updateOrder, updateOrderStatus, archiveOrder } from '@/lib/orders-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const order = await getOrderById(params.id)
  if (!order) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
  return NextResponse.json(order)
})

export const DELETE = withApiAuth({ module: 'orders', action: 'edit' }, async (_req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    await archiveOrder(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('deleteOrder error:', error)
    return NextResponse.json({ error: '刪除訂單失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  const user        = session.user as any
  const role        = user?.role        as string | undefined
  const accountType = user?.accountType as string | undefined
  const isAdmin     = role === 'admin' || accountType === '行政' || accountType === '中央管理'

  try {
    const body = await req.json()
    const existing = await getOrderById(params.id)
    if (!existing) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })

    // 非行政帳號：確認訂單仍在草稿狀態才允許修改
    if (!isAdmin && existing.status !== '草稿') {
      return NextResponse.json(
        { error: `訂單已${existing.status}，僅行政帳號可修改` },
        { status: 403 }
      )
    }

    // 行政帳號改動非草稿訂單的品項/價格：屬於覆寫已凍結的價格快照，
    // 必須明確確認（confirmNonDraftEdit）且一定要留稽核紀錄，不可悄悄改動。
    const touchesItems = Array.isArray(body.items)
    const isNonDraftItemEdit = isAdmin && existing.status !== '草稿' && touchesItems
    if (isNonDraftItemEdit && !body.confirmNonDraftEdit) {
      return NextResponse.json(
        { error: `訂單已${existing.status}，修改品項/價格將覆寫已凍結的單據紀錄，請明確確認後再試` },
        { status: 400 }
      )
    }

    // If only status is provided, use quick status update
    if (body.status && Object.keys(body).length === 1) {
      await updateOrderStatus(params.id, body.status)
    } else {
      await updateOrder(params.id, body)
    }

    if (isNonDraftItemEdit) {
      await logAuditEvent({
        module: 'orders',
        action: 'update',
        entityType: 'order',
        entityId: params.id,
        entityTitle: existing.orderNumber,
        summary: `覆寫非草稿訂單品項/價格：${existing.orderNumber}（原狀態：${existing.status}）`,
        actor: getAuditActor(session),
        request: getAuditRequestContext(req),
        before: { items: existing.items, totalAmount: existing.totalAmount, status: existing.status },
        after: { items: body.items },
      }).catch((e) => console.error('audit updateOrder (non-draft) error:', e))
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('updateOrder error:', error)
    const isValidationError = typeof error?.message === 'string' && (
      error.message.includes('數量須為正整數') ||
      error.message.includes('單價不可為負數') ||
      error.message.includes('不存在於產品目錄') ||
      error.message.includes('贈品／樣品總數量')
    )
    return NextResponse.json(
      { error: isValidationError ? error.message : '更新訂單失敗' },
      { status: isValidationError ? 400 : 500 }
    )
  }
})
