import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getManagedFamilies } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async () => {
  try {
    const families = await getManagedFamilies(true)
    const skuCodes = Array.from(new Set(families.flatMap((family) => explicitFamilySkuCodes(family))))
    return NextResponse.json({ skuCodes })
  } catch (error) {
    console.error('GET /api/products/notion-assignments error:', error)
    return NextResponse.json({ error: '系列歸屬暫時無法完整讀取' }, { status: 503 })
  }
})
