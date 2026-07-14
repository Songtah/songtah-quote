import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getManagedFamilies } from '@/lib/products-managed-families'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('central-management', async () => {
  try {
    return NextResponse.json(await getManagedFamilies(true))
  } catch (error) {
    console.error('GET /api/products/families/manage error:', error)
    return NextResponse.json({ error: '系列管理資料暫時無法完整讀取，已停用編輯以保護現有歸屬' }, { status: 503 })
  }
})
