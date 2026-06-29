import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { searchSystemCustomers } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const city = req.nextUrl.searchParams.get('city') || undefined
  const district = req.nextUrl.searchParams.get('district') || undefined
  const salesperson = req.nextUrl.searchParams.get('salesperson') || undefined
  const type = req.nextUrl.searchParams.get('type') || undefined

  try {
    const customers = await searchSystemCustomers(q, { city, district, salesperson, type })
    return NextResponse.json(customers)
  } catch (error) {
    console.error('searchSystemCustomers error:', error)
    return NextResponse.json({ error: '無法搜尋客戶' }, { status: 500 })
  }
})
