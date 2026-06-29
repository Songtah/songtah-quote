/**
 * GET /api/admin/medical-monitor/changes?month=YYYY-MM
 * 本月異動：讀「診所監控紀錄」DB 該月的新開業/新增停業/停業/恢復開業。
 * 需兩個月 BAS 快照才有資料（月排程比對產生）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMonthlyMonitorChanges } from '@/lib/system-notion'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '僅管理員可查看醫事監控' }, { status: 403 })
  }
  const month = req.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7)
  const changes = await getMonthlyMonitorChanges(month)
  return NextResponse.json({ month, changes })
}
