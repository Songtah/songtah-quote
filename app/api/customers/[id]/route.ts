import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemCustomerById, listCustomerEquipment, listCustomerTickets, listVisits } from '@/lib/system-notion'
import { listQuotesByCustomer } from '@/lib/notion'
import { listOrdersByCustomer } from '@/lib/orders-notion'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const { id } = params
  const customer = await getSystemCustomerById(id)
  if (!customer) return NextResponse.json({ error: '找不到客戶' }, { status: 404 })

  const [equipment, tickets, visits, quotes, orders] = await Promise.all([
    listCustomerEquipment(id),
    listCustomerTickets(id),
    listVisits({ customerId: id, fetchAll: true }).then((r) => r.items),
    listQuotesByCustomer(id).catch((e) => { console.error('customers/[id]: 報價讀取失敗', e); return [] }),
    listOrdersByCustomer(id).catch((e) => { console.error('customers/[id]: 訂單讀取失敗', e); return [] }),
  ])

  return NextResponse.json({ customer, equipment, tickets, visits, quotes, orders })
})
