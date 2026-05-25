import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { searchProducts } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q        = req.nextUrl.searchParams.get('q')        ?? ''
  const brand    = req.nextUrl.searchParams.get('brand')    ?? ''
  const type     = req.nextUrl.searchParams.get('type')     ?? ''
  const category = req.nextUrl.searchParams.get('category') ?? ''

  let products = await searchProducts(q)

  if (brand)    products = products.filter((p) => p.manufacturer === brand)
  if (type)     products = products.filter((p) => p.productType  === type)
  if (category) products = products.filter((p) => p.category     === category)

  return NextResponse.json(products)
}
