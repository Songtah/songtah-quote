/**
 * POST /api/visits/auto-link
 *
 * 批次補齊客情紀錄的客戶關聯。
 * 抓取沒有連結客戶（🏥 牙科單位資料 is_empty）的拜訪紀錄，
 * 對每筆用客戶名稱搜尋客戶資料庫，若剛好只有一個結果就自動關聯。
 *
 * Body: { cursor?: string, batchSize?: number, dryRun?: boolean }
 * Response:
 *   { linked, skipped, noMatch, multiMatch, nextCursor, hasMore, examples }
 *   - linked      : 本批次成功關聯的筆數
 *   - skipped     : 略過（搜不到 or 多個候選）
 *   - noMatch     : 搜不到任何候選的客戶名稱清單（前 5 個）
 *   - multiMatch  : 多個候選無法自動決定的清單（前 5 個）
 *   - nextCursor  : 下一頁的 cursor（null 表示已到底）
 *   - hasMore     : 是否還有更多
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { Client } from '@notionhq/client'
import { customerNameStem, pickUniqueCustomerMatch } from '@/lib/customer-name-match'
import { searchSystemCustomers } from '@/lib/system-notion'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const VISITS_DB = process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16'

function normId(id: string) {
  return id.replace(/-/g, '')
}

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const cursor   = body.cursor   as string | undefined
    const batchSize = Math.min(Number(body.batchSize) || 30, 50)
    const dryRun   = Boolean(body.dryRun)

    // ── 1. 抓取沒有客戶關聯的拜訪紀錄 ─────────────────────────────────
    const response: any = await notion.databases.query({
      database_id: normId(VISITS_DB),
      page_size: batchSize,
      filter: {
        property: '🏥 牙科單位資料',
        relation: { is_empty: true },
      },
      sorts: [{ property: '日期', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    })

    const pages = response.results ?? []
    const hasMore: boolean = response.has_more ?? false
    const nextCursor: string | null = response.next_cursor ?? null

    // ── 2. 對每筆搜尋客戶 ────────────────────────────────────────────
    let linked = 0, noMatchCount = 0, multiMatchCount = 0
    const noMatchNames: string[] = []
    const multiMatchNames: string[] = []

    for (const page of pages) {
      const titleProp = page.properties?.['單位名稱']
      const rawName: string = (titleProp?.title ?? [])
        .map((t: any) => t.plain_text)
        .join('')
        .trim()

      if (!rawName) continue

      // 先用整串簡稱查；查不到再用字根重查一次（「誠鴻牙科」→「誠鴻」）。
      // searchSystemCustomers 連地址／行政區都比對，回傳的候選可能與名稱無關，
      // 因此**不論候選幾筆**都必須通過名稱字根驗證才可關聯（見 lib/customer-name-match）。
      let customers = await searchSystemCustomers(rawName)
      const stem = customerNameStem(rawName)
      if (customers.length === 0 && stem && stem !== rawName) {
        customers = await searchSystemCustomers(stem)
      }

      const match = pickUniqueCustomerMatch(rawName, customers)
      if (!match) {
        if (customers.length === 0) {
          noMatchCount++
          if (noMatchNames.length < 5) noMatchNames.push(rawName)
        } else {
          // 有候選但名稱驗不過或不唯一 → 交給人工，不亂猜
          multiMatchCount++
          if (multiMatchNames.length < 5) multiMatchNames.push(rawName)
        }
        continue
      }

      if (!dryRun) {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            '🏥 牙科單位資料': { relation: [{ id: match.id }] },
            // 同時把簡稱補齊為主檔的完整名稱
            '單位名稱': { title: [{ text: { content: match.name } }] },
          } as any,
        })
      }
      linked++
    }

    const skipped = noMatchCount + multiMatchCount

    return NextResponse.json({
      linked,
      skipped,
      noMatch: noMatchCount,
      multiMatch: multiMatchCount,
      noMatchNames,
      multiMatchNames,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      total: pages.length,
    })
  } catch (error: any) {
    console.error('auto-link error:', error)
    return NextResponse.json({ error: error?.message ?? '自動關聯失敗' }, { status: 500 })
  }
})
