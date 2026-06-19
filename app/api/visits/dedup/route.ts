/**
 * POST /api/visits/dedup
 *
 * 找出重複的客情紀錄並刪除（保留內容最完整的一筆）。
 * 重複定義：同「客戶名稱 + 日期 + 業務人員」視為同一次拜訪。
 * 同組內保留 content 最長（最完整）的一筆，其餘封存（archived）。
 *
 * 輕量實作：直接分頁查 Notion，只讀必要欄位、不解析客戶/產品關聯，
 * 避免一次解析全部關聯造成 Notion API 429（rate limit）。
 *
 * Body: { dryRun?: boolean }
 * Response: { groups, duplicates, deleted, examples, total }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Client } from '@notionhq/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const VISITS_DB = (process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16').replace(/-/g, '')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = { id: string; customerName: string; date: string; salesperson: string; contentLen: number }

function readRow(page: any): Row {
  const props = page.properties ?? {}
  const title = (props['單位名稱']?.title ?? []).map((t: any) => t.plain_text).join('').trim()
  const date = props['日期']?.date?.start ?? ''
  const salesperson =
    props['業務人員']?.select?.name ??
    (props['業務人員']?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim() ??
    ''
  const content = (props['拜訪內容']?.rich_text ?? []).map((t: any) => t.plain_text).join('')
  return { id: page.id, customerName: title, date, salesperson, contentLen: content.length }
}

const norm = (s: string) => (s ?? '').toLowerCase().trim()

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const dryRun = Boolean(body.dryRun)

    // 分頁讀取（只讀必要欄位，頁間節流避免 rate limit）
    const rows: Row[] = []
    let cursor: string | undefined
    do {
      const res: any = await notion.databases.query({
        database_id: VISITS_DB,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
      for (const p of res.results ?? []) rows.push(readRow(p))
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
      if (cursor) await sleep(350)
    } while (cursor)

    // 以 客戶+日期+業務 分組
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      if (!r.customerName || !r.date) continue
      const key = `${norm(r.customerName)}|${r.date}|${norm(r.salesperson)}`
      const arr = groups.get(key)
      if (arr) arr.push(r)
      else groups.set(key, [r])
    }

    const toDelete: Row[] = []
    const examples: { customerName: string; date: string; salesperson: string; count: number }[] = []
    let dupGroups = 0

    for (const arr of Array.from(groups.values())) {
      if (arr.length < 2) continue
      dupGroups++
      arr.sort((a, b) => b.contentLen - a.contentLen) // 內容最完整者保留
      toDelete.push(...arr.slice(1))
      if (examples.length < 10) {
        examples.push({
          customerName: arr[0].customerName,
          date: arr[0].date,
          salesperson: arr[0].salesperson,
          count: arr.length,
        })
      }
    }

    let deleted = 0
    if (!dryRun) {
      for (const r of toDelete) {
        try {
          await notion.pages.update({ page_id: r.id, archived: true })
          deleted++
          await sleep(350) // 刪除節流，避免 rate limit
        } catch {
          // 單筆失敗略過
        }
      }
    }

    return NextResponse.json({
      groups: dupGroups,
      duplicates: toDelete.length,
      deleted,
      examples,
      total: rows.length,
    })
  } catch (error: any) {
    console.error('dedup error:', error)
    const msg = error?.code === 'rate_limited' || error?.status === 429
      ? 'Notion 請求過於頻繁，請等幾分鐘再試'
      : (error?.message ?? '刪除重複失敗')
    return NextResponse.json({ error: msg }, { status: error?.status === 429 ? 429 : 500 })
  }
}
