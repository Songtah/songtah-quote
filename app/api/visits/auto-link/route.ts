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

import { dbVisitsUnlinked } from '@/lib/db/visits-write'
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { loadMatchContext, matchVisitCustomer } from '@/lib/notion/match-context'
import { loadAliases } from '@/lib/notion/visit-alias'
import { recordVisitBump, updateVisit } from '@/lib/notion/visits'
import { searchSystemCustomers } from '@/lib/system-notion'


export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const cursor   = body.cursor   as string | undefined
    const batchSize = Math.min(Number(body.batchSize) || 30, 50)
    const dryRun   = Boolean(body.dryRun)

    // ── 1. 抓取沒有客戶關聯的拜訪紀錄 ─────────────────────────────────
    const offset = cursor?.startsWith('o:') ? Number(cursor.slice(2)) || 0 : 0
    const page1 = await dbVisitsUnlinked(batchSize, offset)
    const pages = page1.rows
    // 消歧義脈絡：同一批次共用一份（快取），避免逐筆重算
    const matchCtx = await loadMatchContext()
    const aliases = await loadAliases().catch(() => ({ manual: {}, learned: {} }))
    const hasMore: boolean = page1.hasMore
    const nextCursor: string | null = hasMore ? `o:${offset + batchSize}` : null

    // ── 2. 對每筆搜尋客戶 ────────────────────────────────────────────
    let linked = 0, noMatchCount = 0, multiMatchCount = 0
    const noMatchNames: string[] = []
    const multiMatchNames: string[] = []

    for (const page of pages) {
      const rawName: string = page.name.trim()
      if (!rawName) continue

      // 與建檔、夜間補關聯同一套規則（慣用稱呼記憶 → 名稱字根＋業務脈絡），見 matchVisitCustomer
      const salesperson: string = page.sp
      const res = await matchVisitCustomer({
        name: rawName, salesperson, ctx: matchCtx, aliases,
        search: (q) => searchSystemCustomers(q),
      })
      const match = res.id ? { id: res.id, name: res.candidates.find((c) => c.id.replace(/-/g, '') === res.id!.replace(/-/g, ''))?.name ?? '' } : null
      if (!match) {
        if (res.candidates.length === 0) {
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
        // 只補關聯、不覆寫單位名稱：業務原本的叫法要留著，夜間「慣用稱呼記憶」才學得到
        await updateVisit(page.id, { customerId: match.id })
        await recordVisitBump(match.id, page.date)
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
