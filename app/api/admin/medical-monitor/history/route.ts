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
  const history = await getMonitorHistory()
  return NextResponse.json({ history })
}
