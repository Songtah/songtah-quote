import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getOrderById, updateOrder, updateOrderStatus, archiveOrder } from '@/lib/orders-notion'
import { updateCustomerDevStage } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { orderActorOf, findOrderTransition, canEditOrderContent, canDeleteOrder } from '@/lib/order-status'

const VALIDATION_HINTS = ['數量須為正整數', '單價不可為負數', '不存在於產品目錄', '已停用', '贈品／樣品總數量', '促銷驗證未通過']
const CONTENT_KEYS = [
  'date', 'salesperson', 'note', 'items', 'customerId', 'customerName', 'companyTitle', 'customerAddress',
  'customerPhone', 'contactPerson', 'customerTaxId', 'promotionId', 'promotionName',
  'requestedDate', 'paymentMethod', 'deliveryMethod',
]

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const order = await getOrderById(params.id)
  if (!order) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
  return NextResponse.json(order)
})

/** 業務只能刪草稿；行政可刪任何狀態（建議改用「取消」保留紀錄）。一律留稽核紀錄。 */
export const DELETE = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const existing = await getOrderById(params.id)
    if (!existing) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
    if (!canDeleteOrder(existing.status, orderActorOf(session.user))) {
      return NextResponse.json({ error: `訂單已${existing.status}，只有行政帳號可以刪除；如不需要了請改用「取消訂單」` }, { status: 403 })
    }
    await archiveOrder(params.id)
    await logAuditEvent({
      module: 'orders', action: 'delete', entityType: 'order', entityId: params.id, entityTitle: existing.orderNumber,
      summary: `刪除訂貨單：${existing.orderNumber}（${existing.status}）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req), before: existing,
    }).catch((e) => console.error('audit deleteOrder error:', e))
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('deleteOrder error:', error)
    return NextResponse.json({ error: '刪除訂單失敗' }, { status: 500 })
  }
})

/**
 * PATCH：狀態轉換與內容修改。
 *   - 狀態：一律依 lib/order-status 的 ORDER_TRANSITIONS（誰能從哪個狀態轉到哪個狀態）
 *   - 內容：業務只能改草稿；行政可改未取消的單，改「非草稿」的品項／價格須 confirmNonDraftEdit＋稽核
 */
export const PATCH = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  const actor = orderActorOf(session.user)
  try {
    const body = await req.json()
    const existing = await getOrderById(params.id)
    if (!existing) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })

    const wantsStatus = typeof body.status === 'string' && body.status && body.status !== existing.status
    const touchesContent = CONTENT_KEYS.some((k) => body[k] !== undefined)

    if (wantsStatus && !findOrderTransition(existing.status, body.status, actor)) {
      return NextResponse.json(
        { error: `訂單目前為「${existing.status}」，${actor === 'staff' ? '' : '業務帳號'}不能直接改成「${body.status}」` },
        { status: 403 },
      )
    }
    if (touchesContent && !canEditOrderContent(existing.status, actor)) {
      return NextResponse.json({ error: `訂單已${existing.status}，${actor === 'staff' ? '已取消的訂單請先恢復為草稿' : '僅行政帳號可修改內容；需要調整可先「撤回修改」'}` }, { status: 403 })
    }

    // 行政改動非草稿訂單的品項/價格：屬於覆寫已凍結的價格快照，必須明確確認且一定要留稽核紀錄
    const isNonDraftItemEdit = actor === 'staff' && existing.status !== '草稿' && Array.isArray(body.items)
    if (isNonDraftItemEdit && !body.confirmNonDraftEdit) {
      return NextResponse.json(
        { error: `訂單已${existing.status}，修改品項/價格將覆寫已凍結的單據紀錄，請明確確認後再試` },
        { status: 400 }
      )
    }

    if (touchesContent) {
      const { confirmNonDraftEdit: _c, ...data } = body
      await updateOrder(params.id, { ...data, status: wantsStatus ? body.status : undefined })
    } else if (wantsStatus) {
      await updateOrderStatus(params.id, body.status)
    }

    // 訂單到貨＝成交訊號:同步客戶開發階段(業務開發漏斗鐵則——只在此推進,不覆蓋機構狀態)
    if (wantsStatus && body.status === '已到貨' && existing.customerId) {
      await updateCustomerDevStage(existing.customerId, { devStage: '已成交' }).catch((e) =>
        console.error(`order ${existing.orderNumber}: 開發階段同步失敗`, e)
      )
    }

    if (wantsStatus || isNonDraftItemEdit) {
      await logAuditEvent({
        module: 'orders', action: 'update', entityType: 'order', entityId: params.id, entityTitle: existing.orderNumber,
        summary: [
          wantsStatus ? `訂貨單 ${existing.orderNumber}：${existing.status} → ${body.status}` : '',
          isNonDraftItemEdit ? `覆寫非草稿訂單品項/價格（原狀態：${existing.status}）` : '',
        ].filter(Boolean).join('；'),
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        before: { status: existing.status, ...(isNonDraftItemEdit ? { items: existing.items, totalAmount: existing.totalAmount } : {}) },
        after: { status: wantsStatus ? body.status : existing.status, ...(isNonDraftItemEdit ? { items: body.items } : {}) },
      }).catch((e) => console.error('audit updateOrder error:', e))
    }

    return NextResponse.json({ ok: true, status: wantsStatus ? body.status : existing.status })
  } catch (error: any) {
    console.error('updateOrder error:', error)
    const isValidationError = typeof error?.message === 'string' && VALIDATION_HINTS.some((h) => error.message.includes(h))
    return NextResponse.json(
      { error: isValidationError ? error.message : '更新訂單失敗' },
      { status: isValidationError ? 400 : 500 }
    )
  }
})
