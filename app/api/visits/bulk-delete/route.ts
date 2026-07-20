/**
 * POST /api/visits/bulk-delete
 *
 * 批次刪除（封存）多筆客情紀錄。
 * Body: { ids: string[] }
 * Response: { deleted, failed }
 *
 * 逐筆封存並節流（每筆間隔），避免 Notion API rate limit（429）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { deleteVisit, getVisitById } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  let ids: string[] = []
  try {
    const body = await req.json()
    ids = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : []
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (ids.length === 0) return NextResponse.json({ error: '未選取任何項目' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: '一次最多刪除 200 筆' }, { status: 400 })

  let deleted = 0
  let failed = 0
  const user = session.user as any
  const canDeleteAll = user?.role === 'admin' || user?.accountType === '中央管理'
  for (const id of ids) {
    try {
      const visit = await getVisitById(id)
      if (!canDeleteAll && visit.salesperson !== session.user?.name) {
        failed++
        continue
      }
      await deleteVisit(id)
      deleted++
      await sleep(300) // 節流避免 rate limit
    } catch {
      failed++
    }
  }

  return NextResponse.json({ deleted, failed })
})
