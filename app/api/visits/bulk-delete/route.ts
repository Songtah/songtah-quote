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
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteVisit } from '@/lib/system-notion'
import { canEdit } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'crm')) {
    return NextResponse.json({ error: '無批次刪除客情紀錄權限' }, { status: 403 })
  }

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
  for (const id of ids) {
    try {
      await deleteVisit(id)
      deleted++
      await sleep(300) // 節流避免 rate limit
    } catch {
      failed++
    }
  }

  return NextResponse.json({ deleted, failed })
}
