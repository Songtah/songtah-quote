import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAllSystemCustomers } from '@/lib/system-notion'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  try {
    const customers = await getAllSystemCustomers()
    return NextResponse.json(customers)
  } catch (error) {
    console.error('getAllSystemCustomers error:', error)
    return NextResponse.json([], { status: 200 }) // graceful fallback
  }
}
