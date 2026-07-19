/**
 * GET /api/equipment/[id]/tickets — 該設備的維修紀錄(依「設備資料」relation 反查)
 * 供設備詳情頁顯示維修履歷。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listEquipmentTickets } from '@/lib/notion/tickets'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const tickets = await listEquipmentTickets(params.id)
  return NextResponse.json(tickets)
})
