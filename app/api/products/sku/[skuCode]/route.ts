import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import { getProductRichData, upsertProductRichData } from '@/lib/products-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { getManagedFamilies, getManagedFamilyById } from '@/lib/products-managed-families'

export const dynamic = 'force-dynamic'

type Ctx = { params: { skuCode: string } }

// ── GET /api/products/sku/[skuCode] ──────────────────────────
// Returns { catalog, rich } — catalog is read-only, rich is editable.
export const GET = withApiAuth<Ctx>('session', async (_req, { params }) => {
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
      price:       catalog.price ?? null,
    },
    rich: rich ?? { notionId: null, price: null, imageUrl: '', description: '', specsJson: '', galleryJson: '', docsJson: '', familyId: '' },
  })
})

// ── PUT /api/products/sku/[skuCode] ──────────────────────────
// Body: { price?: number | null, imageUrl?: string, description?: string }
export const PUT = withApiAuth<Ctx>('central-management', async (req, { params }, session) => {
  const { skuCode } = params
  const catalog = getCatalogProduct(skuCode)
  if (!catalog) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })

  let body: { imageUrl?: string; description?: string; specsJson?: string; galleryJson?: string; docsJson?: string; familyId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  for (const field of ['imageUrl', 'description', 'specsJson', 'galleryJson', 'docsJson', 'familyId'] as const) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      return NextResponse.json({ error: `${field} 必須是字串` }, { status: 400 })
    }
  }

  try {
    if (body.familyId !== undefined) {
      if (body.familyId) {
        const targetFamily = await getManagedFamilyById(body.familyId, true)
        if (!targetFamily) return NextResponse.json({ error: '指定的系列群組不存在，請重新整理後再試' }, { status: 400 })
      } else {
        await getManagedFamilies(true)
      }
    }
    const before = await getProductRichData(skuCode).catch(() => null)
    const notionId = await upsertProductRichData(
      skuCode,
      {
        name:        catalog.name,
        brand:       catalog.brand,
        category:    catalog.category,
        productType: catalog.productType,
      },
      {
        imageUrl:    body.imageUrl,
        description: body.description,
        specsJson:   body.specsJson,
        galleryJson: body.galleryJson,
        docsJson:    body.docsJson,
        familyId:    body.familyId,
      }
    )
    const after = await getProductRichData(skuCode)
    if (!after) throw new Error('產品資料寫入後無法讀回')
    const expectedFields = {
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.specsJson !== undefined ? { specsJson: body.specsJson } : {}),
      ...(body.galleryJson !== undefined ? { galleryJson: body.galleryJson } : {}),
      ...(body.docsJson !== undefined ? { docsJson: body.docsJson } : {}),
      ...(body.familyId !== undefined ? { familyId: body.familyId } : {}),
    }
    const mismatchedFields = Object.entries(expectedFields)
      .filter(([field, value]) => after[field as keyof typeof after] !== value)
      .map(([field]) => field)
    if (mismatchedFields.length > 0) throw new Error(`產品資料讀回不一致：${mismatchedFields.join(', ')}`)
    await logAuditEvent({
      module: 'products',
      action: 'update',
      entityType: 'product',
      entityId: skuCode,
      entityTitle: catalog.name,
      summary: `更新產品資料：${catalog.name}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before,
      after,
      metadata: { readBack: 'passed' },
    }).catch((error) => console.error('audit product update error:', error))
    return NextResponse.json({ ok: true, notionId })
  } catch (err: any) {
    const msg: string = err?.message ?? String(err)
    const code: string = err?.code ?? ''
    console.error('[PUT /api/products/sku]', skuCode, code, msg)
    // Surface the real error so it's visible in the UI (helps diagnose Notion errors)
    return NextResponse.json(
      { error: `儲存失敗：${code ? code + ' — ' : ''}${msg.slice(0, 200)}` },
      { status: 500 },
    )
  }
})
