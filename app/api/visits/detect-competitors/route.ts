/**
 * POST /api/visits/detect-competitors
 *
 * 批次掃描拜訪紀錄內文，偵測競品關鍵字並補齊競品欄位。
 * 只處理「競品欄位為空」的紀錄，避免覆蓋已手動填寫的資料。
 *
 * Body: { cursor?: string, batchSize?: number, dryRun?: boolean }
 * Response:
 *   { filled, skipped, noContent, nextCursor, hasMore, total, examples }
 *   - filled     : 成功填入競品的筆數
 *   - skipped    : 內文沒找到競品的筆數
 *   - noContent  : 內文為空，略過的筆數
 *   - examples   : 成功案例（前 5 筆）{ customerName, detected[] }
 */

import { dbVisitsWithoutCompetitors } from '@/lib/db/visits-write'
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getVisitFormOptions } from '@/lib/system-notion'
import { updateVisit } from '@/lib/notion/visits'
import { detectCompetitors } from '@/lib/competitor-detector'


export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const body      = await req.json().catch(() => ({}))
    const cursor    = body.cursor    as string | undefined
    const batchSize = Math.min(Number(body.batchSize) || 30, 50)
    const dryRun    = Boolean(body.dryRun)

    // ── 1. 取得 Notion 競品選項清單 ───────────────────────────────
    const formOptions = await getVisitFormOptions()
    const competitorOptions = formOptions.competitorOptions

    if (!competitorOptions.length) {
      return NextResponse.json({ error: '競品清單是空的，請聯絡系統管理員加入競品' }, { status: 400 })
    }

    // ── 2. 抓取競品欄位為空的拜訪紀錄 ────────────────────────────
    const offset = cursor?.startsWith('o:') ? Number(cursor.slice(2)) || 0 : 0
    const page1 = await dbVisitsWithoutCompetitors(batchSize, offset)
    const pages     = page1.rows
    const hasMore   = page1.hasMore
    const nextCursor = hasMore ? `o:${offset + batchSize}` : null

    // ── 3. 逐筆偵測 ───────────────────────────────────────────────
    let filled = 0, skipped = 0, noContent = 0
    const examples: { customerName: string; detected: string[] }[] = []

    for (const page of pages) {
      // 取得客戶名稱（for logging）
      const customerName: string = page.name.trim()
      const content: string = page.text.trim()

      if (!content) {
        noContent++
        continue
      }

      const detected = detectCompetitors(content, competitorOptions)

      if (!detected.length) {
        skipped++
        continue
      }

      // 填入競品
      if (!dryRun) {
        await updateVisit(page.id, { competitorEquipment: detected })
      }

      filled++
      if (examples.length < 5) examples.push({ customerName, detected })
    }

    return NextResponse.json({
      filled,
      skipped,
      noContent,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      total: pages.length,
      competitorOptions,
      examples,
    })
  } catch (error: any) {
    console.error('detect-competitors error:', error)
    return NextResponse.json({ error: error?.message ?? '批次偵測失敗' }, { status: 500 })
  }
})
