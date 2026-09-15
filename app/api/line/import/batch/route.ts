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
import { customerNameStem } from '@/lib/customer-name-match'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 30

/**
 * 去重鍵與 webhook（lib/line-report-ingest）一致：業務＋日期＋客戶名稱字根。
 * 原本只比「完整名稱＋日期」：同一家寫法不同（「誠鴻牙科」vs「誠鴻牙醫診所」）會重複建立，
 * 不同業務同日拜訪同一家則會被誤判為重複而漏掉。
 */
const dedupKey = (salesperson: string, date: string, name: string) =>
  `${salesperson}|${date}|${(customerNameStem(name) || name).toLowerCase().replace(/\s/g, '')}`

/** 內容完全相同＝同一筆（日報原文照抄）；太短的內容不當依據 */
const contentKey = (salesperson: string, date: string, content: string) => {
  const c = (content ?? '').replace(/\s/g, '')
  return c.length >= 10 ? `c:${salesperson}|${date}|${c}` : ''
}

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  let visits: ParsedVisitItem[]
  let offset: number

  try {
    const body = await req.json()
    visits = body.visits ?? []
    offset = body.offset ?? 0
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const user = session.user as any
  const canImportForOthers = user?.role === 'admin' || user?.accountType === '中央管理'
  const actorName = session.user?.name ?? ''
  if (!canImportForOthers) {
    visits = visits
      .filter((visit) => visit.salesperson === actorName)
      .map((visit) => ({ ...visit, salesperson: actorName }))
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
      existingSet.add(dedupKey(v.salesperson, v.date, v.customerName))
      // 列表上的名稱是客戶主檔正式名稱（與日報簡稱不同），另以「業務＋日期＋內容」比對同一筆
      const ck = contentKey(v.salesperson, v.date, v.content)
      if (ck) existingSet.add(ck)
    }
  }

  const formOptions = await getVisitFormOptions()

  let imported = 0, skipped = 0, errors = 0

  for (const item of batch) {
    const key = dedupKey(item.salesperson, item.date, item.customerName)
    const ck = contentKey(item.salesperson, item.date, item.content)
    if (existingSet.has(key) || (ck && existingSet.has(ck))) { skipped++; continue }

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
        // 解析器已依內容推斷到期日（講「下週回」就 +7 天，沒講就 +14 天），
        // 這裡原本硬寫空字串把它丟掉——實測 9/1 之後 185 筆有 50 筆標了需追蹤、
        // 到期日卻 0 筆，導致「逾期追蹤」這個最優先的訊號完全無法運作。
        nextFollowUpDate: item.nextFollowUpDate ?? '',
        status: '',
        address: '', city: '', district: '',
        tags: [], competitorEquipment: [], interestedProductIds: [],
      })

      existingSet.add(key)
      if (ck) existingSet.add(ck)
      imported++
    } catch {
      errors++
    }
  }

  const nextOffset = offset + BATCH_SIZE
  const hasMore = nextOffset < visits.length

  return NextResponse.json({ imported, skipped, errors, hasMore, nextOffset })
})
