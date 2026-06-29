import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { searchSystemCustomers } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (!q.trim()) return NextResponse.json([])

  const customers = await searchSystemCustomers(q)
  return NextResponse.json(customers)
})
