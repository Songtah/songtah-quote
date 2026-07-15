import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getAvailableCatalog } from '@/lib/products-availability'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async () => {
  const products = await getAvailableCatalog()
  return NextResponse.json({
    brands: Array.from(new Set(products.map((product) => product.brand).filter(Boolean))).sort(),
    productTypes: Array.from(new Set(products.map((product) => product.productType).filter(Boolean))).sort(),
    categories: Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort(),
  })
})
