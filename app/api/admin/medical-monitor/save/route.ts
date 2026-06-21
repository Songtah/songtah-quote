/**
 * POST /api/admin/medical-monitor/save
 * 手動「儲存比對紀錄」：把最近一次比對的每月數量寫入永久 Notion「醫事數量趨勢」DB。
 * （Redis 每月紀錄已於每次比對自動更新；此按鈕另存一份到 Notion 永久檔。）
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMonitorHistory, upsertMedicalTrend } from '@/lib/system-notion'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  const history = await getMonitorHistory()
  if (!history.length) return NextResponse.json({ error: '尚無比對結果，請先「執行比對」' }, { status: 400 })
  try {
    await upsertMedicalTrend(history[0])   // history 為新到舊，[0]＝最近一次比對（當月）
    return NextResponse.json({ ok: true, month: history[0].month })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '儲存失敗' }, { status: 500 })
  }
}
