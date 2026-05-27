import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import { getProductRichData, upsertProductRichData } from '@/lib/products-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { skuCode: string } }

// ── GET /api/products/sku/[skuCode] ──────────────────────────
// Returns { catalog, rich } — catalog is read-only, rich is editable.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { skuCode } = params
  const catalog = getCatalogProduct(skuCode)
  if (!catalog) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })

  const rich = await getProductRichData(skuCode).catch(() => null)

  return NextResponse.json({
    catalog: {
      code:        catalog.code,
      name:        catalog.name,
      brand:       catalog.brand,
      productType: catalog.productType,
      category:    catalog.category,
    },
    rich: rich ?? { notionId: null, price: null, imageUrl: '', description: '', specsJson: '' },
  })
}

// ── PUT /api/products/sku/[skuCode] ──────────────────────────
// Body: { price?: number | null, imageUrl?: string, description?: string }
export async function PUT(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = (session.user as any)?.role
  if (role !== 'admin') {
    const perms = (session.user as any)?.permissions
    if (perms && !perms?.products?.edit)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { skuCode } = params
  const catalog = getCatalogProduct(skuCode)
  if (!catalog) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })

  let body: { price?: number | null; imageUrl?: string; description?: string; specsJson?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const notionId = await upsertProductRichData(
      skuCode,
      {
        name:        catalog.name,
        brand:       catalog.brand,
        category:    catalog.category,
        productType: catalog.productType,
      },
      {
        price:       body.price,
        imageUrl:    body.imageUrl,
        description: body.description,
        specsJson:   body.specsJson,
      }
    )
    return NextResponse.json({ ok: true, notionId })
  } catch (err) {
    console.error('[PUT /api/products/sku]', err)
    return NextResponse.json({ error: '儲存失敗，請稍後再試' }, { status: 500 })
  }
}
