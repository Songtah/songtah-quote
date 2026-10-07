import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOrders, listOrderSummaries, createOrder } from '@/lib/orders-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

/** ?view=summary：清單頁用，只回訂單摘要（不含品項明細），避免每次掃全部明細 */
export const GET = withApiAuth('session', async (req: NextRequest) => {
  try {
    const summary = req.nextUrl.searchParams.get('view') === 'summary'
    const orders = summary ? await listOrderSummaries() : await listOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('listOrders error:', error)
    return NextResponse.json({ error: '讀取訂單失敗' }, { status: 500 })
  }
})

const VALIDATION_HINTS = ['數量須為正整數', '單價不可為負數', '不存在於產品目錄', '已停用', '贈品／樣品總數量', '促銷驗證未通過']

export const POST = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const body = await req.json()
    const {
      date, salesperson, note, items, status,
      customerId, customerName, companyTitle,
      customerAddress, customerPhone, contactPerson, customerTaxId,
      promotionId, promotionName, requestedDate, paymentMethod, deliveryMethod,
    } = body

    if (!date || !salesperson || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '缺少必要欄位（日期、業務、品項）' }, { status: 400 })
    }
    // 新單只能是草稿或直接送出；確認中／已到貨須由行政依狀態機轉換（lib/order-status）
    const initialStatus = status === '已送出' ? '已送出' : '草稿'

    const order = await createOrder({
      date, salesperson, note: note ?? '', items, status: initialStatus,
      customerId, customerName, companyTitle,
      customerAddress, customerPhone, contactPerson, customerTaxId,
      promotionId, promotionName, requestedDate, paymentMethod, deliveryMethod,
    })

    await logAuditEvent({
      module: 'orders', action: 'create', entityType: 'order', entityId: order.id, entityTitle: order.orderNumber,
      summary: `建立訂貨單：${order.orderNumber}（${initialStatus}）${order.customerName ? `・${order.customerName}` : ''}`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: order, metadata: { itemCount: items.length },
    }).catch((e) => console.error('audit createOrder error:', e))

    return NextResponse.json(order, { status: 201 })
  } catch (error: any) {
    console.error('createOrder error:', error)
    const isValidationError = typeof error?.message === 'string' && VALIDATION_HINTS.some((h) => error.message.includes(h))
    return NextResponse.json(
      { error: isValidationError ? error.message : '建立訂單失敗' },
      { status: isValidationError ? 400 : 500 }
    )
  }
})
