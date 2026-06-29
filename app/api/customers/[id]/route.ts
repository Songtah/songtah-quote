import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemCustomerById, listCustomerEquipment, listCustomerTickets, listVisits } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const { id } = params
  const customer = await getSystemCustomerById(id)
  if (!customer) return NextResponse.json({ error: '找不到客戶' }, { status: 404 })

  const [equipment, tickets, visits] = await Promise.all([
    listCustomerEquipment(id),
    listCustomerTickets(id),
    listVisits({ customerId: id, fetchAll: true }).then((r) => r.items),
  ])

  return NextResponse.json({ customer, equipment, tickets, visits })
})
