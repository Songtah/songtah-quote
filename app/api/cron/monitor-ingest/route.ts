/**
 * POST /api/cron/monitor-ingest — 每月醫事快照（GitHub Action scripts/clinic-monitor.mjs）把異動紀錄與數量趨勢送進資料庫。
 * body: { records?: MonitorRecordInput[]; trend?: {...month} }。x-cron-secret: DAILY_REPORT_SECRET（timing-safe）。
 * 2026-11-10 起取代直接寫 Notion「診所監控紀錄」「醫事數量趨勢」。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { hasDb } from '@/lib/db/client'
import { dbInsertMonitorRecords, dbUpsertMedicalTrend, type MonitorRecordInput } from '@/lib/db/monitor'
import { deleteRedisValue } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL 未設定' }, { status: 503 })
  try {
    const body = await req.json().catch(() => ({})) as { records?: MonitorRecordInput[]; trend?: any }
    const records = Array.isArray(body.records) ? body.records.filter((r) => r && typeof r.type === 'string').slice(0, 5000) : []
    const inserted = await dbInsertMonitorRecords(records)
    if (body.trend?.month) await dbUpsertMedicalTrend(body.trend)
    for (const m of [3, 6, 12]) deleteRedisValue(`clinic-monitor:${m}`)
    return NextResponse.json({ ok: true, inserted, trend: !!body.trend?.month })
  } catch (error: any) {
    console.error('monitor-ingest error:', error)
    return NextResponse.json({ error: error?.message ?? '寫入失敗' }, { status: 500 })
  }
}
