/**
 * GET /api/products/catalog-raw
 *
 * Returns the full catalog (all 6 000+ SKUs) in a compact format
 * specifically for the product catalog manager (/products/catalog).
 *
 * Requires login. Intentionally NOT rate-limited to 200 because this
 * endpoint is only called once on page mount of the admin catalog page.
 *
 * Response shape matches CatalogItem in CatalogManagerContent:
 *   { code, name, brand, productType, category }[]
 */

import { NextRequest, NextResponse } from 'next/server'
import { listDisabledSkuCodes } from '@/lib/products-notion'
import { getEffectiveCatalog } from '@/lib/products-availability'
import { withApiAuth } from '@/lib/api-auth'
import { isCentralManagement } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (_req: NextRequest, _ctx, session) => {
  const [effectiveCatalog, disabledSkuCodes] = await Promise.all([
    getEffectiveCatalog(true),
    listDisabledSkuCodes(),
  ])
  const disabledCodes = new Set(disabledSkuCodes)
  const allItems = effectiveCatalog.map((item) => ({
    ...item,
    disabled: disabledCodes.has(item.code),
  }))
  const items = isCentralManagement(session)
    ? allItems
    : allItems.filter((item) => !item.discontinued && !item.disabled)

  return NextResponse.json(items, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  })
})
