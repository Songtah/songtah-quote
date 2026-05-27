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
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCatalog } from '@/lib/products-catalog'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = getCatalog()   // module-level cache, no disk re-read

  return NextResponse.json(items, {
    headers: {
      // Allow the browser to cache this for 5 min (catalog changes rarely)
      'Cache-Control': 'private, max-age=300',
    },
  })
}
