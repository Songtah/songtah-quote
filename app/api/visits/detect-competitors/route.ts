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

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { Client } from '@notionhq/client'
import { getVisitFormOptions } from '@/lib/system-notion'
import { detectCompetitors } from '@/lib/competitor-detector'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const VISITS_DB = process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16'

function normId(id: string) {
  return id.replace(/-/g, '')
}

export const POST = withApiAuth({ module: 'crm', action: 'edit' }, async (req: NextRequest) => {
  try {
    const body      = await req.json().catch(() => ({}))
    const cursor    = body.cursor    as string | undefined
    const batchSize = Math.min(Number(body.batchSize) || 30, 50)
    const dryRun    = Boolean(body.dryRun)

    // ── 1. 取得 Notion 競品選項清單 ───────────────────────────────
    const formOptions = await getVisitFormOptions()
    const competitorOptions = formOptions.competitorOptions

    if (!competitorOptions.length) {
      return NextResponse.json({ error: 'Notion 競品欄位尚無選項，請先在 Notion 建立競品選項' }, { status: 400 })
    }

    // ── 2. 抓取競品欄位為空的拜訪紀錄 ────────────────────────────
    const response: any = await notion.databases.query({
      database_id: normId(VISITS_DB),
      page_size: batchSize,
      filter: {
        property: '競品',
        multi_select: { is_empty: true },
      },
      sorts: [{ property: '日期', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    })

    const pages     = response.results ?? []
    const hasMore   = response.has_more ?? false
    const nextCursor = response.next_cursor ?? null

    // ── 3. 逐筆偵測 ───────────────────────────────────────────────
    let filled = 0, skipped = 0, noContent = 0
    const examples: { customerName: string; detected: string[] }[] = []

    for (const page of pages) {
      // 取得客戶名稱（for logging）
      const titleProp = page.properties?.['單位名稱']
      const customerName: string = (titleProp?.title ?? [])
        .map((t: any) => t.plain_text).join('').trim()

      // 取得內文（拜訪內容欄位）
      const contentProp = page.properties?.['拜訪內容']
      const content: string = (contentProp?.rich_text ?? [])
        .map((t: any) => t.plain_text).join('').trim()

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
        await notion.pages.update({
          page_id: page.id,
          properties: {
            競品: { multi_select: detected.map((name) => ({ name })) },
          } as any,
        })
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
