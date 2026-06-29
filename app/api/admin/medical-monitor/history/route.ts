/**
 * GET /api/admin/medical-monitor/history
 * 回傳每月比對紀錄（趨勢對照用，伺服器端持久、刷新不消失）。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getMonitorHistory } from '@/lib/system-notion'

export const GET = withApiAuth('admin', async () => {
  const history = await getMonitorHistory()
  return NextResponse.json({ history })
})
