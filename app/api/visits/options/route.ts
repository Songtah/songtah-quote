import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getVisitFormOptions } from '@/lib/system-notion'

export const GET = withApiAuth('session', async () => {
  try {
    const options = await getVisitFormOptions()
    return NextResponse.json(options)
  } catch {
    return NextResponse.json({ salespersons: [], statuses: [] }, { status: 500 })
  }
})
