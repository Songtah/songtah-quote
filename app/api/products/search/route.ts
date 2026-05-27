import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { searchCatalog } from '@/lib/products-catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q           = req.nextUrl.searchParams.get('q')           ?? ''
  const brand       = req.nextUrl.searchParams.get('brand')       ?? ''
  const productType = req.nextUrl.searchParams.get('type')        ?? ''
  const category    = req.nextUrl.searchParams.get('category')    ?? ''
  const limitParam  = req.nextUrl.searchParams.get('limit')       ?? '50'
  const limit       = Math.min(parseInt(limitParam, 10) || 50, 9999)

  const products = searchCatalog({
    q,
    brand:       brand       || undefined,
    productType: productType || undefined,
    category:    category    || undefined,
    limit,
  })

  // Map to the shape the existing UI expects (OrderForm / QuoteForm)
  return NextResponse.json(
    products.map((p) => ({
      id:           p.code,  // use code as ID for catalog items
      name:         p.name,
      manufacturer: p.brand,
      productType:  p.productType,
      category:     p.category,
      skuCode:      p.code,
      // Fields not in the static catalog — left empty; Notion-backed entries fill these
      price:        null,
      salePrice:    null,
      notes:        '',
    }))
  )
}
