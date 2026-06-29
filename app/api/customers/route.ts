import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { searchCustomers } from '@/lib/notion'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q') ?? ''
  try {
    const customers = await searchCustomers(q)
    return NextResponse.json(customers)
  } catch (err) {
    console.error('searchCustomers error:', err)
    return NextResponse.json({ error: '無法搜尋客戶' }, { status: 500 })
  }
}
