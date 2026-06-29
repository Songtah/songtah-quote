/**
 * GET /api/system-customers/names
 *
 * 回傳輕量的客戶名稱索引，供前端模糊搜尋使用。
 * 只包含 id + name，快取 10 分鐘。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getAllSystemCustomers } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async () => {
  try {
    const all = await getAllSystemCustomers()
    const index = all.map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city ?? '',
      district: c.district ?? '',
      type: c.type ?? '',
      salesperson: c.salesperson ?? '',
      status: c.status ?? '',
    }))
    return NextResponse.json(index, {
      headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=60' },
    })
  } catch (error) {
    console.error('customer names index error:', error)
    return NextResponse.json({ error: '無法取得客戶名稱索引' }, { status: 500 })
  }
})
