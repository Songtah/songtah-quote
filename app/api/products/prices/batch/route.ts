/**
 * POST /api/products/prices/batch —— 定價工作區／批次漲幅寫入（僅中央管理）
 * Body: { items: [{ code, price }], source: 'workspace' | 'batch', note? }
 * 一次最多 25 筆（前端分段送），逐筆寫 Notion「售價」→ 讀回驗證 → 刷新售價快取 → 記調價紀錄＋稽核。
 * 停售品不可定價；價格必須是正整數。既有報價／訂單的價格快照不受影響。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import { getProductRichData, invalidateProductPriceOverrideCache, listProductPriceOverrides, upsertProductRichData } from '@/lib/products-notion'
import { recordPriceChanges, type PriceChange } from '@/lib/product-pricing'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_ITEMS = 25

export const POST = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  let body: { items?: { code?: unknown; price?: unknown }[]; source?: unknown; note?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const items = Array.isArray(body.items) ? body.items : []
  const source = body.source === 'batch' ? 'batch' : 'workspace'
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : undefined
  if (items.length === 0 || items.length > MAX_ITEMS) return NextResponse.json({ error: `一次 1～${MAX_ITEMS} 筆` }, { status: 400 })

  const parsed: { code: string; price: number; product: NonNullable<ReturnType<typeof getCatalogProduct>> }[] = []
  for (const item of items) {
    const code = typeof item.code === 'string' ? item.code : ''
    const product = getCatalogProduct(code)
    if (!product) return NextResponse.json({ error: `找不到貨號 ${code}` }, { status: 400 })
    if (product.discontinued) return NextResponse.json({ error: `${code} 已停售，不能定價` }, { status: 400 })
    const price = item.price
    if (typeof price !== 'number' || !Number.isInteger(price) || price <= 0 || price > 10_000_000) {
      return NextResponse.json({ error: `${code} 的售價必須是正整數` }, { status: 400 })
    }
    parsed.push({ code, price, product })
  }

  const overrides = await listProductPriceOverrides()
  const actor = getAuditActor(session)
  const done: PriceChange[] = []
  const failed: { code: string; error: string }[] = []
  for (const { code, price, product } of parsed) {
    const before = overrides[code] ?? product.price ?? null
    try {
      await upsertProductRichData(code, { name: product.name, brand: product.brand, category: product.category, productType: product.productType }, { price })
      const after = await getProductRichData(code)
      if (after?.price !== price) throw new Error('寫入後讀回不一致')
      done.push({ code, name: product.officialName || product.name, brand: product.brand, before, after: price, at: Date.now(), actor: actor.name || '中央管理', source, note })
    } catch (error) {
      failed.push({ code, error: error instanceof Error ? error.message.slice(0, 120) : '寫入失敗' })
    }
  }

  let cache: 'refreshed' | 'invalidated' = 'refreshed'
  try { await listProductPriceOverrides(true) } catch { invalidateProductPriceOverrideCache(); cache = 'invalidated' }
  let recorded = true
  try { await recordPriceChanges(done) } catch (error) { recorded = false; console.error('[prices/batch] record changes failed:', error) }

  if (done.length > 0) {
    await logAuditEvent({
      module: 'products', action: 'update', entityType: 'product-price', entityId: done.map((change) => change.code).slice(0, 5).join(','),
      entityTitle: `${source === 'batch' ? '批次調價' : '定價'} ${done.length} 筆`,
      summary: `${source === 'batch' ? '批次調價' : '定價工作區'}：${done.length} 筆${note ? `（${note}）` : ''}`,
      actor, request: getAuditRequestContext(req),
      before: Object.fromEntries(done.map((change) => [change.code, change.before])),
      after: Object.fromEntries(done.map((change) => [change.code, change.after])),
      metadata: { readBack: 'passed', priceCache: cache, recorded, failed: failed.length },
    }).catch((error) => console.error('audit price batch error:', error))
  }

  return NextResponse.json({ ok: failed.length === 0, updated: done.map(({ code, before, after }) => ({ code, before, after })), failed, recorded })
})
