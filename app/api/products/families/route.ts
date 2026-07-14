import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getManagedFamilies } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  const code = req.nextUrl.searchParams.get('code') ?? ''
  const families = await getManagedFamilies()

  if (code) {
    const family = families.find((item) => explicitFamilySkuCodes(item).includes(code))
    return NextResponse.json(family ?? null)
  }

  return NextResponse.json(families)
})
