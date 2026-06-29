/**
 * POST /api/line/import/batch
 *
 * 第二步：接收一批 visit，寫入 Notion。
 * 每批 30 筆，前端循環呼叫直到 hasMore: false。
 *
 * Body: { visits: ParsedVisitItem[], offset: number }
 * Response: { imported, skipped, errors, hasMore, nextOffset }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { createVisit, listVisits, getVisitFormOptions } from '@/lib/system-notion'
import type { ParsedVisitItem } from '@/app/api/line/import/route'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 30

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  let visits: ParsedVisitItem[]
  let offset: number

  try {
    const body = await req.json()
    visits = body.visits ?? []
    offset = body.offset ?? 0
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  // 本批次範圍
  const batch = visits.slice(offset, offset + BATCH_SIZE)
  if (batch.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, errors: 0, hasMore: false, nextOffset: offset })
  }

  // 取得本批次日期範圍，查既有紀錄做去重
  const dates = batch.map((v) => v.date).sort()
  const dateFrom = dates[0]
  const dateTo = dates[dates.length - 1]

  const existingResult = await listVisits({ dateFrom, dateTo, fetchAll: true })
  const existingSet = new Set<string>()
  for (const v of existingResult.items) {
    if (v.customerName && v.date) {
      existingSet.add(`${v.customerName.toLowerCase().trim()}|${v.date}`)
    }
  }

  const formOptions = await getVisitFormOptions()

  let imported = 0, skipped = 0, errors = 0

  for (const item of batch) {
    const key = `${item.customerName.toLowerCase().trim()}|${item.date}`
    if (existingSet.has(key)) { skipped++; continue }

    try {
      const validReaction = formOptions.customerReactions.includes(item.customerReaction)
        ? item.customerReaction : ''

      await createVisit({
        customerName: item.customerName,
        date: item.date,
        salesperson: item.salesperson,
        content: item.content,
        interactionType: '拜訪',
        interactionPurpose: '',
        customerReaction: validReaction,
        followUpAction: '',
        needsFollowUp: item.needsFollowUp,
        nextFollowUpDate: '',
        status: '',
        address: '', city: '', district: '',
        tags: [], competitorEquipment: [], interestedProductIds: [],
      })

      existingSet.add(key)
      imported++
    } catch {
      errors++
    }
  }

  const nextOffset = offset + BATCH_SIZE
  const hasMore = nextOffset < visits.length

  return NextResponse.json({ imported, skipped, errors, hasMore, nextOffset })
})
