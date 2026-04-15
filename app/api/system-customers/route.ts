import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { searchSystemCustomers } from '@/lib/system-notion'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const city = req.nextUrl.searchParams.get('city') || undefined
  const district = req.nextUrl.searchParams.get('district') || undefined
  const salesperson = req.nextUrl.searchParams.get('salesperson') || undefined

  try {
    const customers = await searchSystemCustomers(q, { city, district, salesperson })
    return NextResponse.json(customers)
  } catch (error) {
    console.error('searchSystemCustomers error:', error)
    return NextResponse.json({ error: '無法搜尋客戶' }, { status: 500 })
  }
}
