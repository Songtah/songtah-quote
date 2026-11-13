/**
 * GET /api/cron/monitor-customers — 每月醫事快照（GitHub Action scripts/clinic-monitor.mjs）讀取客戶主檔。
 * 只回比對需要的欄位（id、名稱、類型、機構代碼、縣市、行政區），不含地址／電話／負責業務。
 * x-cron-secret: DAILY_REPORT_SECRET（timing-safe，未設定即拒絕）。
 * 2026-11-10 起客戶主檔在資料庫、Notion 客戶庫已封存；腳本不得再直接查 Notion。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { hasDb } from '@/lib/db/client'
import { dbGetCustomersWithCodes } from '@/lib/db/customers-read'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const got = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL 未設定' }, { status: 503 })
  try {
    const rows = await dbGetCustomersWithCodes()
    const customers = rows.map((c) => ({ id: c.id, name: c.name, type: c.type, code: c.institutionCode, city: c.city, dist: c.district }))
    return NextResponse.json({ customers })
  } catch (error: any) {
    console.error('monitor-customers error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
}
