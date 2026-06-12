/**
 * GET /api/products/prices
 *
 * 回傳全目錄的價格對照表 { [貨號]: { p: 售價, s: 優惠價 } }。
 * 供訂貨單／報價單的系列規格矩陣選品時即時帶入單價。
 * 只包含有價格的品項（目前約 2,400 筆），payload 很小。
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCatalog } from '@/lib/products-catalog'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const map: Record<string, { p: number; s?: number }> = {}
  for (const item of getCatalog()) {
    if (item.price == null) continue
    map[item.code] = item.salePrice != null
      ? { p: item.price, s: item.salePrice }
      : { p: item.price }
  }

  return NextResponse.json(map, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
