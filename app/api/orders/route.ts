import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listOrders, createOrder } from '@/lib/orders-notion'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const orders = await listOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('listOrders error:', error)
    return NextResponse.json({ error: '讀取訂單失敗' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  // 需要 orders.edit 權限（admin / env 帳號 / 明確授權）
  const user = session.user as any
  const role = user?.role as string | undefined
  const perms = user?.permissions as Record<string, { view: boolean; edit: boolean }> | undefined
  const hasEdit = role === 'admin' || !perms || (perms?.orders?.edit ?? false)
  if (!hasEdit) return NextResponse.json({ error: '無建立訂單權限' }, { status: 403 })

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
      error.message.includes('贈品／樣品總數量')
    )
    return NextResponse.json(
      { error: isValidationError ? error.message : '建立訂單失敗' },
      { status: isValidationError ? 400 : 500 }
    )
  }
}
