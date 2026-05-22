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

  try {
    const body = await req.json()
    const { date, salesperson, note, items, status } = body

    if (!date || !salesperson || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '缺少必要欄位（日期、業務、品項）' }, { status: 400 })
    }

    const order = await createOrder({ date, salesperson, note: note ?? '', items, status })
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    console.error('createOrder error:', error)
    return NextResponse.json({ error: '建立訂單失敗' }, { status: 500 })
  }
}
