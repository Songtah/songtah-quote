import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSystemTicketById } from '@/lib/system-notion'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const ticket = await getSystemTicketById(params.id)
    return NextResponse.json(ticket)
  } catch {
    return NextResponse.json({ error: '找不到案件' }, { status: 404 })
  }
}
