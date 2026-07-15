import { NextRequest, NextResponse } from 'next/server'
import { searchCatalog } from '@/lib/products-catalog'
import { withApiAuth } from '@/lib/api-auth'
import { getAvailableCatalog } from '@/lib/products-availability'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (req: NextRequest) => {
  const q           = req.nextUrl.searchParams.get('q')           ?? ''
  const brand       = req.nextUrl.searchParams.get('brand')       ?? ''
  const productType = req.nextUrl.searchParams.get('type')        ?? ''
  const category    = req.nextUrl.searchParams.get('category')    ?? ''
  const limitParam  = req.nextUrl.searchParams.get('limit')       ?? '50'
  const limit       = Math.min(parseInt(limitParam, 10) || 50, 200)

  const availableCatalog = await getAvailableCatalog()
  const products = searchCatalog({
    q,
    brand:       brand       || undefined,
    productType: productType || undefined,
    category:    category    || undefined,
    limit,
  }, availableCatalog)

  // Map to the shape the existing UI expects (OrderForm / QuoteForm)
  return NextResponse.json(
    products.map((p) => ({
      id:           p.code,  // use code as ID for catalog items
      name:         p.name,
      manufacturer: p.brand,
      productType:  p.productType,
      category:     p.category,
      skuCode:      p.code,
      // 售價來自主檔（價格表回填）；無價格的品項為 null
      price:        p.price ?? null,
      salePrice:    p.salePrice ?? null,
      notes:        '',
    }))
  )
})
