import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listAuditLogs } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '禁止存取' }, { status: 403 })
  }

  try {
    const p = req.nextUrl.searchParams
    const limit = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)
    const cursor = p.get('cursor') ?? undefined
    const result = await listAuditLogs({ limit, cursor })
    return NextResponse.json(result)
  } catch (error) {
    console.error('listAuditLogs error:', error)
    return NextResponse.json({ error: '讀取操作紀錄失敗' }, { status: 500 })
  }
}
