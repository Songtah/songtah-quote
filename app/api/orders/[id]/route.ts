import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrderById, updateOrder, updateOrderStatus, archiveOrder } from '@/lib/orders-notion'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const order = await getOrderById(params.id)
  if (!order) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
  return NextResponse.json(order)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    await archiveOrder(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('deleteOrder error:', error)
    return NextResponse.json({ error: '刪除訂單失敗' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const user        = session.user as any
  const role        = user?.role        as string | undefined
  const accountType = user?.accountType as string | undefined
  const isAdmin     = role === 'admin' || accountType === '行政' || accountType === '中央管理'

  try {
    const body = await req.json()

    // 非行政帳號：確認訂單仍在草稿狀態才允許修改
    if (!isAdmin) {
      const existing = await getOrderById(params.id)
      if (!existing) return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
      if (existing.status !== '草稿') {
        return NextResponse.json(
          { error: `訂單已${existing.status}，僅行政帳號可修改` },
          { status: 403 }
        )
      }
    }

    // If only status is provided, use quick status update
    if (body.status && Object.keys(body).length === 1) {
      await updateOrderStatus(params.id, body.status)
    } else {
      await updateOrder(params.id, body)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('updateOrder error:', error)
    return NextResponse.json({ error: '更新訂單失敗' }, { status: 500 })
  }
}
