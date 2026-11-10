// GET /api/settings/db-sync — 資料庫同步狀態（僅中央管理）
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { hasDb } from '@/lib/db/client'
import { getSyncStatus } from '@/lib/db/sync-notion'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('central-management', async () => {
  if (!hasDb()) return NextResponse.json({ configured: false })
  try {
    const status = await getSyncStatus()
    return NextResponse.json({ configured: true, ...status })
  } catch (error: any) {
    return NextResponse.json({ configured: true, error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
