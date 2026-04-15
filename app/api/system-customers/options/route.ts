import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCustomerFilterOptions } from '@/lib/system-notion'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  try {
    const options = await getCustomerFilterOptions()
    return NextResponse.json(options)
  } catch {
    return NextResponse.json({ cities: [], districts: [], salespersons: [] })
  }
}
