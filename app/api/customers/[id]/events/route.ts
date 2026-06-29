import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomerEvents } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const events = await listCustomerEvents(params.id)
  return NextResponse.json(events)
})
