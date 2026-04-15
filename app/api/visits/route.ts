import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listVisits, createVisit } from '@/lib/system-notion'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const customerName = req.nextUrl.searchParams.get('customerName') ?? undefined
  const visits = await listVisits(customerName ? { customerName } : undefined)
  return NextResponse.json(visits)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  const { customerName, date, salesperson, status, content, address, city, district, customerId } = body

  if (!customerName) return NextResponse.json({ error: '客戶名稱必填' }, { status: 400 })

  const visit = await createVisit({ customerName, date, salesperson, status, content, address, city, district, customerId })
  return NextResponse.json(visit, { status: 201 })
}
