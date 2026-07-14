import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import { getManagedFamilies } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'
import { getProductRichData, upsertProductRichData } from '@/lib/products-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

type Ctx = { params: { id: string } }
type FailedItem = { skuCode: string; error: string }

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

export const POST = withApiAuth<Ctx>('central-management', async (req: NextRequest, { params }, session) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '批次內容不是有效的 JSON' }, { status: 400 })
  }

  const rawCodes = (body as { skuCodes?: unknown })?.skuCodes
  if (!Array.isArray(rawCodes) || rawCodes.length === 0 || rawCodes.length > 100) {
    return NextResponse.json({ error: '每次請選擇 1–100 個品項' }, { status: 400 })
  }
  if (rawCodes.some((code) => typeof code !== 'string' || !code.trim())) {
    return NextResponse.json({ error: '貨號格式不正確' }, { status: 400 })
  }
  const skuCodes = Array.from(new Set(rawCodes.map((code) => code.trim())))

  let families: Awaited<ReturnType<typeof getManagedFamilies>>
  try {
    families = await getManagedFamilies(true)
  } catch (error) {
    console.error('batch family assignment readiness error:', error)
    return NextResponse.json({ error: '系列歸屬資料無法完整讀取，已停止批次加入' }, { status: 503 })
  }
  const family = families.find((item) => item.id === params.id)
  if (!family) return NextResponse.json({ error: '目標系列不存在，請重新整理後再試' }, { status: 404 })

  const catalogs = new Map(skuCodes.map((skuCode) => [skuCode, getCatalogProduct(skuCode)]))
  const missingCodes = skuCodes.filter((skuCode) => !catalogs.get(skuCode))
  if (missingCodes.length > 0) {
    return NextResponse.json({ error: '部分貨號不存在', missingCodes }, { status: 400 })
  }

  const previousFamilyBySku = new Map<string, string>()
  for (const existingFamily of families) {
    for (const skuCode of explicitFamilySkuCodes(existingFamily)) {
      if (!previousFamilyBySku.has(skuCode)) previousFamilyBySku.set(skuCode, existingFamily.id)
    }
  }

  const outcomes = await mapWithConcurrency(skuCodes, 3, async (skuCode) => {
    const catalog = catalogs.get(skuCode)!
    try {
      await upsertProductRichData(
        skuCode,
        {
          name: catalog.name,
          brand: catalog.brand,
          category: catalog.category,
          productType: catalog.productType,
        },
        { familyId: family.id },
      )
      const readBack = await getProductRichData(skuCode)
      if (!readBack || readBack.familyId !== family.id) throw new Error('寫入後讀回不一致')
      return { skuCode, ok: true as const }
    } catch (error) {
      console.error('batch family assignment item error:', skuCode, error)
      return {
        skuCode,
        ok: false as const,
        error: error instanceof Error ? error.message.slice(0, 120) : '寫入失敗',
      }
    }
  })

  const succeeded = outcomes.filter((item) => item.ok).map((item) => item.skuCode)
  const failed: FailedItem[] = outcomes
    .filter((item): item is Extract<(typeof outcomes)[number], { ok: false }> => !item.ok)
    .map((item) => ({ skuCode: item.skuCode, error: item.error }))

  await logAuditEvent({
    module: 'products',
    action: 'bulk-assign',
    entityType: 'product-series',
    entityId: family.id,
    entityTitle: family.seriesName,
    summary: `批次加入系列：${family.seriesName}（成功 ${succeeded.length}，失敗 ${failed.length}）`,
    actor: getAuditActor(session),
    request: getAuditRequestContext(req),
    before: Object.fromEntries(skuCodes.map((skuCode) => [skuCode, previousFamilyBySku.get(skuCode) ?? ''])),
    after: { familyId: family.id, succeeded, failed },
  }).catch((error) => console.error('audit batch family assignment error:', error))

  return NextResponse.json(
    { ok: failed.length === 0, succeeded, failed },
    { status: failed.length === 0 ? 200 : 207 },
  )
})
