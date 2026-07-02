/**
 * /api/visits/follow-ups — 跨月待追蹤清單與結案
 *
 * GET  → 所有未結案的待追蹤拜訪（是否需追蹤=true 且 追蹤已結案=false，不限月份）
 * PATCH → { id } 結案一筆追蹤（可逆，僅勾選 checkbox）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listOpenFollowUps, closeFollowUp } from '@/lib/notion/visits'

export const GET = withApiAuth('session', async () => {
  try {
    const items = await listOpenFollowUps()
    return NextResponse.json({ items })
  } catch (error) {
    console.error('listOpenFollowUps error:', error)
    return NextResponse.json({ error: '讀取待追蹤清單失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest) => {
  try {
    const { id } = await req.json()
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '缺少追蹤紀錄 id' }, { status: 400 })
    }
    await closeFollowUp(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('closeFollowUp error:', error)
    return NextResponse.json({ error: '結案失敗' }, { status: 500 })
  }
})
