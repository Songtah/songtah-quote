/**
 * POST /api/visits/dedup
 *
 * 找出重複的客情紀錄並刪除（保留內容最完整的一筆）。
 * 重複定義：同「客戶名稱 + 日期 + 業務人員」視為同一次拜訪。
 * 同組內保留 content 最長（最完整）的一筆，其餘封存（archived）。
 *
 * Body: { dryRun?: boolean }
 * Response:
 *   { groups, duplicates, deleted, examples }
 *   - groups     : 有重複的組數
 *   - duplicates : 多出來（可刪）的紀錄總數
 *   - deleted    : 實際刪除數（dryRun 時為 0）
 *   - examples   : 前 10 組重複範例（客戶/日期/業務/筆數）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listVisits, deleteVisit, type Visit } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function norm(s: string) {
  return (s ?? '').toLowerCase().trim()
}

// 完整度評分：內容越長、填寫欄位越多者保留
function completeness(v: Visit): number {
  let score = (v.content ?? '').length
  if (v.customerId) score += 50
  if (v.customerReaction) score += 10
  if (v.interactionType) score += 5
  if ((v.competitorEquipment ?? []).length) score += 5
  return score
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const dryRun = Boolean(body.dryRun)

    // 抓全部客情紀錄
    const all = await listVisits({ fetchAll: true })
    const items = all.items

    // 以 客戶+日期+業務 分組
    const groups = new Map<string, Visit[]>()
    for (const v of items) {
      if (!v.customerName || !v.date) continue
      const key = `${norm(v.customerName)}|${v.date}|${norm(v.salesperson)}`
      const arr = groups.get(key)
      if (arr) arr.push(v)
      else groups.set(key, [v])
    }

    // 找出重複組，決定要刪的（保留最完整一筆）
    const toDelete: Visit[] = []
    const examples: { customerName: string; date: string; salesperson: string; count: number }[] = []
    let dupGroups = 0

    for (const arr of Array.from(groups.values())) {
      if (arr.length < 2) continue
      dupGroups++
      // 完整度高的排前面 → 保留 [0]，刪其餘
      arr.sort((a, b) => completeness(b) - completeness(a))
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
      for (const v of toDelete) {
        try {
          await deleteVisit(v.id)
          deleted++
        } catch {
          // 單筆失敗略過，繼續刪其餘
        }
      }
    }

    return NextResponse.json({
      groups: dupGroups,
      duplicates: toDelete.length,
      deleted,
      examples,
      total: items.length,
    })
  } catch (error: any) {
    console.error('dedup error:', error)
    return NextResponse.json({ error: error?.message ?? '刪除重複失敗' }, { status: 500 })
  }
}
