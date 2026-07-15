import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getManagedFamilies } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'
import { getAvailableManagedFamilies } from '@/lib/products-availability'
import { isCentralManagement } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  const code = req.nextUrl.searchParams.get('code') ?? ''
  const includeDisabled = req.nextUrl.searchParams.get('includeDisabled') === '1' && isCentralManagement(session)
  const families = includeDisabled ? await getManagedFamilies() : await getAvailableManagedFamilies()

  if (code) {
    const family = families.find((item) => explicitFamilySkuCodes(item).includes(code))
    return NextResponse.json(family ?? null)
  }

  return NextResponse.json(families)
})
