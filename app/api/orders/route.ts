import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOrders, createOrder } from '@/lib/orders-notion'

export const GET = withApiAuth('session', async () => {
  try {
    const orders = await listOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('listOrders error:', error)
    return NextResponse.json({ error: '讀取訂單失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth({ module: 'orders', action: 'edit' }, async (req: NextRequest) => {
  try {
    const body = await req.json()
    const {
      date, salesperson, note, items, status,
      customerId, customerName, companyTitle,
      customerAddress, customerPhone, contactPerson, customerTaxId,
    } = body

    if (!date || !salesperson || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '缺少必要欄位（日期、業務、品項）' }, { status: 400 })
    }

    const order = await createOrder({
      date, salesperson, note: note ?? '', items, status,
      customerId, customerName, companyTitle,
      customerAddress, customerPhone, contactPerson, customerTaxId,
    })
    return NextResponse.json(order, { status: 201 })
  } catch (error: any) {
    console.error('createOrder error:', error)
    const isValidationError = typeof error?.message === 'string' && (
      error.message.includes('數量須為正整數') ||
      error.message.includes('單價不可為負數') ||
      error.message.includes('不存在於產品目錄') ||
      error.message.includes('已停用') ||
      error.message.includes('贈品／樣品總數量') ||
      error.message.includes('促銷驗證未通過')
    )
    return NextResponse.json(
      { error: isValidationError ? error.message : '建立訂單失敗' },
      { status: isValidationError ? 400 : 500 }
    )
  }
})
