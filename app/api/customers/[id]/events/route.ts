import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomerEvents, listAllEvents } from '@/lib/notion/events'

/** 客戶頁「活動足跡」：報名紀錄帶上活動名稱與日期（報名紀錄本身只存機構名稱） */
export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const regs = await listCustomerEvents(params.id)
  if (!regs.length) return NextResponse.json([])
  const events = new Map((await listAllEvents().catch(() => [])).map((e) => [e.id, e]))
  return NextResponse.json(regs.map((r) => {
    const ev = events.get(r.eventId)
    return { ...r, eventName: ev?.name || r.formEventName || '', eventDate: ev?.date ?? '', eventType: ev?.type ?? '' }
  }))
})
