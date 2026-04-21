import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listAuditLogs } from '@/lib/audit'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '禁止存取' }, { status: 403 })
  }

  try {
    const logs = await listAuditLogs(100)
    return NextResponse.json(logs)
  } catch (error) {
    console.error('listAuditLogs error:', error)
    return NextResponse.json({ error: '讀取操作紀錄失敗' }, { status: 500 })
  }
}
