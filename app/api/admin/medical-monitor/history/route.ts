/**
 * GET /api/admin/medical-monitor/history
 * 回傳每月比對紀錄（趨勢對照用，伺服器端持久、刷新不消失）。
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMonitorHistory } from '@/lib/system-notion'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '僅管理員可查看醫事監控' }, { status: 403 })
  }
  const history = await getMonitorHistory()
  return NextResponse.json({ history })
}
