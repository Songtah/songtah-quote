import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import {
  getProductRichData,
  invalidateProductPriceOverrideCache,
  listDisabledSkuCodes,
  listProductPriceOverrides,
  updateDisabledSkuCache,
  upsertProductRichData,
} from '@/lib/products-notion'
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

  let rich
  try {
    rich = await getProductRichData(skuCode)
  } catch (error) {
    console.error('[GET /api/products/sku] rich data unavailable:', skuCode, error)
    return NextResponse.json({ error: '產品資料暫時無法完整讀取，為避免誤改停用狀態已停止編輯' }, { status: 503 })
  }

  return NextResponse.json({
    catalog: {
      code:        catalog.code,
      name:        catalog.name,
      brand:       catalog.brand,
      productType: catalog.productType,
      category:    catalog.category,
      price:       rich?.price ?? catalog.price ?? null,
      basePrice:   catalog.price ?? null,
      priceSource: rich?.price != null ? 'override' : catalog.price != null ? 'catalog' : 'unset',
      discontinued: Boolean(catalog.discontinued),
      status:      catalog.status ?? '',
      disabled:    Boolean(rich?.disabled),
    },
    rich: rich ?? { notionId: null, price: null, imageUrl: '', description: '', specsJson: '', galleryJson: '', docsJson: '', familyId: '', disabled: false },
  })
})

// ── PUT /api/products/sku/[skuCode] ──────────────────────────
// Body: { price?: number | null, imageUrl?: string, description?: string }
export const PUT = withApiAuth<Ctx>('central-management', async (req, { params }, session) => {
  const { skuCode } = params
  const catalog = getCatalogProduct(skuCode)
  if (!catalog) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })

  let body: { price?: number | null; imageUrl?: string; description?: string; specsJson?: string; galleryJson?: string; docsJson?: string; familyId?: string; disabled?: boolean }
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
  if (body.disabled !== undefined && typeof body.disabled !== 'boolean') {
    return NextResponse.json({ error: 'disabled 必須是布林值' }, { status: 400 })
  }
  if (body.price !== undefined && body.price !== null && (
    typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0
  )) {
    return NextResponse.json({ error: '售價必須是大於 0 的數字，或留空以清除後台覆寫' }, { status: 400 })
  }

  try {
    const disabledSnapshot = body.disabled !== undefined ? await listDisabledSkuCodes() : null
    if (body.price !== undefined) await listProductPriceOverrides()
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
        price:       body.price,
        imageUrl:    body.imageUrl,
        description: body.description,
        specsJson:   body.specsJson,
        galleryJson: body.galleryJson,
        docsJson:    body.docsJson,
        familyId:    body.familyId,
        disabled:    body.disabled,
      }
    )
    const after = await getProductRichData(skuCode)
    if (!after) throw new Error('產品資料寫入後無法讀回')
    const expectedFields = {
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.specsJson !== undefined ? { specsJson: body.specsJson } : {}),
      ...(body.galleryJson !== undefined ? { galleryJson: body.galleryJson } : {}),
      ...(body.docsJson !== undefined ? { docsJson: body.docsJson } : {}),
      ...(body.familyId !== undefined ? { familyId: body.familyId } : {}),
      ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
    }
    const mismatchedFields = Object.entries(expectedFields)
      .filter(([field, value]) => after[field as keyof typeof after] !== value)
      .map(([field]) => field)
    if (mismatchedFields.length > 0) throw new Error(`產品資料讀回不一致：${mismatchedFields.join(', ')}`)
    if (body.disabled !== undefined && disabledSnapshot) {
      await updateDisabledSkuCache(skuCode, body.disabled, disabledSnapshot)
    }
    let priceCacheStatus: 'unchanged' | 'refreshed' | 'invalidated' = 'unchanged'
    if (body.price !== undefined) {
      // Re-read the full override set so concurrent edits cannot be lost by
      // publishing a stale pre-write snapshot. If that refresh fails after the
      // durable write/read-back, invalidate instead of reporting a false save failure.
      try {
        await listProductPriceOverrides(true)
        priceCacheStatus = 'refreshed'
      } catch (error) {
        invalidateProductPriceOverrideCache()
        priceCacheStatus = 'invalidated'
        console.warn('[PUT /api/products/sku] price cache refresh failed; cache invalidated:', error)
      }
    }
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
      metadata: { readBack: 'passed', priceCache: priceCacheStatus },
    }).catch((error) => console.error('audit product update error:', error))
    return NextResponse.json({
      ok: true,
      notionId,
      price: after.price ?? catalog.price ?? null,
      priceSource: after.price != null ? 'override' : catalog.price != null ? 'catalog' : 'unset',
    })
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
