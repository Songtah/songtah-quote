/**
 * POST /api/products/images/batch — 批次設定產品主圖（中央管理）
 * body: { skuCodes: string[], imageUrl: string, overwrite?: boolean, dryRun?: boolean(預設 true) }
 *   - imageUrl 只接受本系統圖片空間（Vercel Blob，由 /api/products/upload-image 上傳）
 *   - overwrite=false：已有圖片的品項略過；dryRun 只回報會更新／略過的筆數
 * 寫入 Notion「圖片URL」並一次更新縮圖索引；留稽核紀錄。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalogProduct } from '@/lib/products-catalog'
import { setProductImagesBatch } from '@/lib/products-notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX = 500

export const POST = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const skuCodes: string[] = Array.isArray(body?.skuCodes)
    ? Array.from(new Set(body.skuCodes.filter((x: unknown) => typeof x === 'string' && x)))
    : []
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
  const dryRun = body?.dryRun !== false
  const overwrite = body?.overwrite === true

  if (skuCodes.length === 0) return NextResponse.json({ error: '沒有選取品項' }, { status: 400 })
  if (skuCodes.length > MAX) return NextResponse.json({ error: `一次最多 ${MAX} 個品項，請縮小範圍` }, { status: 400 })
  let host = ''
  try { host = new URL(imageUrl).hostname } catch { /* invalid */ }
  if (!host.endsWith('.public.blob.vercel-storage.com')) {
    return NextResponse.json({ error: '圖片需先上傳到本系統（不接受外部網址）' }, { status: 400 })
  }

  const entries: { skuCode: string; catalog: { name: string; brand: string; category: string; productType: string } }[] = []
  const unknown: string[] = []
  for (const skuCode of skuCodes) {
    const p = getCatalogProduct(skuCode)
    if (!p) { unknown.push(skuCode); continue }
    entries.push({ skuCode, catalog: { name: p.name, brand: p.brand, category: p.category, productType: p.productType } })
  }

  try {
    const result = await setProductImagesBatch(entries, imageUrl, { overwrite, dryRun })
    if (!dryRun) {
      await logAuditEvent({
        module: 'products', action: 'update', entityType: 'product-image-batch', entityId: imageUrl,
        summary: `批次設定產品圖片：${result.updated.length} 個品項（略過 ${result.skipped.length}、失敗 ${result.failed.length}）`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { imageUrl, updated: result.updated, overwrite },
        metadata: { skipped: result.skipped.length, failed: result.failed, unknown },
      }).catch((e) => console.error('audit product image batch error:', e))
    }
    return NextResponse.json({ dryRun, ...result, unknown })
  } catch (error: any) {
    console.error('[products/images/batch]', error)
    return NextResponse.json({ error: error?.message ?? '批次設定失敗' }, { status: 500 })
  }
})
