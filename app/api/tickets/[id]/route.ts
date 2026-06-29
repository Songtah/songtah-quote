import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemTicketById } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    const ticket = await getSystemTicketById(params.id)
    return NextResponse.json(ticket)
  } catch {
    return NextResponse.json({ error: '找不到案件' }, { status: 404 })
  }
})
