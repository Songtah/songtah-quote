import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSystemCustomerById, listCustomerEquipment, listCustomerTickets, listVisits } from '@/lib/system-notion'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = params
  const customer = await getSystemCustomerById(id)
  if (!customer) return NextResponse.json({ error: '找不到客戶' }, { status: 404 })

  const [equipment, tickets, visits] = await Promise.all([
    listCustomerEquipment(id),
    listCustomerTickets(id),
    listVisits({ customerId: id }),
  ])

  return NextResponse.json({ customer, equipment, tickets, visits })
}
