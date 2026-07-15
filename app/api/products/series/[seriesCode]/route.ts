import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSeriesByCode, updateSeriesRecord, createSeriesRecord, archiveSeriesRecord } from '@/lib/products-series-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { getAllFamilies, getCatalogProduct } from '@/lib/products-catalog'
import { listSkusByFamilyId, upsertProductRichData } from '@/lib/products-notion'

/** GET /api/products/series/[seriesCode] — get series info by code */
export const GET = withApiAuth<{ params: { seriesCode: string } }>('session', async (
  _req: NextRequest,
  { params }: { params: { seriesCode: string } }
) => {
  try {
    const record = await getSeriesByCode(decodeURIComponent(params.seriesCode))
    return NextResponse.json(record ?? null)
  } catch (e: any) {
    console.error('GET /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '讀取失敗' }, { status: 500 })
  }
})

/**
 * PATCH /api/products/series/[seriesCode]
 * Upsert series info — creates if not exists, updates if exists.
 * Central management only.
 */
export const PATCH = withApiAuth<{ params: { seriesCode: string } }>('central-management', async (
  req: NextRequest,
  { params }: { params: { seriesCode: string } },
  session,
) => {
  try {
    const seriesCode = decodeURIComponent(params.seriesCode)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,49}$/.test(seriesCode)) {
      return NextResponse.json({ error: '系列代碼格式不正確' }, { status: 400 })
    }
    const body = await req.json()
    const seriesName = typeof body.seriesName === 'string' ? body.seriesName.trim() : undefined
    if (seriesName !== undefined && !seriesName) {
      return NextResponse.json({ error: '系列名稱不可空白' }, { status: 400 })
    }
    const patch = {
      ...(seriesName !== undefined ? { seriesName } : {}),
      ...(typeof body.brand === 'string' ? { brand: body.brand.trim() } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.imageUrl === 'string' ? { imageUrl: body.imageUrl.trim() } : {}),
      ...(typeof body.technicalSpecs === 'string' ? { technicalSpecs: body.technicalSpecs } : {}),
      ...(typeof body.applicableScope === 'string' ? { applicableScope: body.applicableScope } : {}),
      ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
    }

    const existing = await getSeriesByCode(seriesCode)
    if (existing) {
      await updateSeriesRecord(existing.id, patch)
    } else {
      const deployedFamily = getAllFamilies().some((family) => family.seriesCode === seriesCode)
      if (!deployedFamily) return NextResponse.json({ error: '系列不存在，請使用建立系列功能' }, { status: 404 })
      await createSeriesRecord({
        seriesCode,
        seriesName: seriesName ?? seriesCode,
        ...patch,
      })
    }

    const updated = await getSeriesByCode(seriesCode)
    if (!updated) throw new Error('系列資料寫入後無法讀回')
    const mismatchedFields = Object.entries(patch)
      .filter(([field, value]) => updated[field as keyof typeof updated] !== value)
      .map(([field]) => field)
    if (mismatchedFields.length > 0) throw new Error(`系列資料讀回不一致：${mismatchedFields.join(', ')}`)
    await logAuditEvent({
      module: 'products',
      action: 'update',
      entityType: 'product-series',
      entityId: seriesCode,
      entityTitle: updated?.seriesName ?? seriesName ?? seriesCode,
      summary: `更新產品系列：${updated?.seriesName ?? seriesName ?? seriesCode}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before: existing,
      after: updated,
      metadata: { readBack: 'passed' },
    }).catch((error) => console.error('audit series update error:', error))
    return NextResponse.json(updated ?? null)
  } catch (e: any) {
    console.error('PATCH /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '更新失敗' }, { status: 500 })
  }
})

/**
 * DELETE /api/products/series/[seriesCode] — 刪除(封存)後台自建系列。
 * Central management only。
 *
 * 限制:只允許刪 Notion 自建系列;部署內建系列(product_families.json 規格矩陣)不可刪。
 * 流程:成員 SKU 的「系列群組」歸屬先清空(退回獨立單品)→ read-back 確認 0 成員 →
 *       封存 Notion 系列紀錄 → read-back 確認查無此系列 → 稽核。任何一步失敗即中止(fail-closed)。
 */
export const DELETE = withApiAuth<{ params: { seriesCode: string } }>('central-management', async (
  req: NextRequest,
  { params }: { params: { seriesCode: string } },
  session,
) => {
  try {
    const seriesCode = decodeURIComponent(params.seriesCode ?? '').trim()
    if (!seriesCode) return NextResponse.json({ error: '缺少系列代碼' }, { status: 400 })

    const record = await getSeriesByCode(seriesCode)
    if (!record) return NextResponse.json({ error: '系列不存在' }, { status: 404 })

    if (getAllFamilies().some((family) => family.seriesCode === seriesCode)) {
      return NextResponse.json({ error: '此為部署內建系列(規格矩陣),不可刪除;僅後台自建系列可刪' }, { status: 400 })
    }

    // 成員退回獨立單品(清空「系列群組」)
    const familyId = `custom:${seriesCode}`
    const memberSkus = await listSkusByFamilyId(familyId)
    for (const skuCode of memberSkus) {
      const catalog = getCatalogProduct(skuCode)
      if (!catalog) continue
      await upsertProductRichData(
        skuCode,
        { name: catalog.name, brand: catalog.brand, category: catalog.category, productType: catalog.productType },
        { familyId: '' },
      )
    }
    const remaining = await listSkusByFamilyId(familyId)
    if (remaining.length > 0) {
      return NextResponse.json({ error: `成員歸屬清除不完全(剩 ${remaining.length} 筆),已中止刪除` }, { status: 500 })
    }

    await archiveSeriesRecord(record.id)
    const after = await getSeriesByCode(seriesCode)
    if (after) return NextResponse.json({ error: '系列封存後仍可讀取,請重試' }, { status: 500 })

    await logAuditEvent({
      module: 'products',
      action: 'delete',
      entityType: 'product-series',
      entityId: seriesCode,
      entityTitle: record.seriesName,
      summary: `刪除產品系列:${record.seriesName}(${memberSkus.length} 個成員退回獨立單品)`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before: record,
      metadata: { releasedMembers: memberSkus.length, readBack: 'passed' },
    }).catch((error) => console.error('audit series delete error:', error))

    return NextResponse.json({ deleted: seriesCode, releasedMembers: memberSkus.length })
  } catch (e: any) {
    console.error('DELETE /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 })
  }
})
