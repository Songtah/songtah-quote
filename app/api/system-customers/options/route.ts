import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCustomerFilterOptions } from '@/lib/system-notion'

export const GET = withApiAuth('session', async () => {
  try {
    const options = await getCustomerFilterOptions()
    return NextResponse.json(options)
  } catch {
    return NextResponse.json({ cities: [], districtsByCity: {}, salespersons: [], types: [] })
  }
})
