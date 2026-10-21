/**
 * POST /api/cron/repair-tickets —— 夜間補開維修工單：日報當下未關聯客戶的維修客情，配對完成後補開
 * 規則見 lib/visit-repair-tickets.ts。由 GitHub Action 夜間呼叫（x-cron-secret: DAILY_REPORT_SECRET，timing-safe）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { processPendingRepairTickets } from '@/lib/visit-repair-tickets'
import { getSystemCustomerById } from '@/lib/notion/customers'
import { notion, notionCallWithRetry, getRelationIds } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verify(req: NextRequest): boolean {
  const secret = process.env.DAILY_REPORT_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('x-cron-secret') ?? ''), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!verify(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const out = await processPendingRepairTickets(async (visitId) => {
      const page: any = await notionCallWithRetry('repair-tickets:visit', () => notion.pages.retrieve({ page_id: visitId }))
      const cid = getRelationIds(page, '🏥 牙科單位資料')[0]
      if (!cid) return null
      const c = await getSystemCustomerById(cid)
      return c ? { customerId: c.id, customerName: c.name } : null
    })
    return NextResponse.json({ ok: true, ...out })
  } catch (error: any) {
    console.error('repair-tickets error:', error)
    return NextResponse.json({ error: error?.message ?? '補開失敗' }, { status: 500 })
  }
}
