/**
 * POST /api/products/images/batch — 批次設定產品主圖（中央管理）
 * body: { skuCodes: string[], imageUrl: string, overwrite?: boolean, dryRun?: boolean(預設 true) }
 *   或 { groups: { imageUrl, skuCodes }[], overwrite?, dryRun? }：多張圖一次處理，縮圖索引只更新一次
 *   （逐張圖各打一次時，每次都要等索引同步，上百張要跑好幾小時）
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

  const dryRun = body?.dryRun !== false
  const overwrite = body?.overwrite === true
  const rawGroups: any[] = Array.isArray(body?.groups) ? body.groups : [{ imageUrl: body?.imageUrl, skuCodes: body?.skuCodes }]
  const isBlobUrl = (url: string) => { try { return new URL(url).hostname.endsWith('.public.blob.vercel-storage.com') } catch { return false } }

  const entries: { skuCode: string; imageUrl: string; catalog: { name: string; brand: string; category: string; productType: string } }[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const group of rawGroups) {
    const url = typeof group?.imageUrl === 'string' ? group.imageUrl.trim() : ''
    if (!isBlobUrl(url)) return NextResponse.json({ error: '圖片需先上傳到本系統（不接受外部網址）' }, { status: 400 })
    for (const skuCode of Array.isArray(group?.skuCodes) ? group.skuCodes : []) {
      if (typeof skuCode !== 'string' || !skuCode || seen.has(skuCode)) continue
      seen.add(skuCode)
      const p = getCatalogProduct(skuCode)
      if (!p) { unknown.push(skuCode); continue }
      entries.push({ skuCode, imageUrl: url, catalog: { name: p.name, brand: p.brand, category: p.category, productType: p.productType } })
    }
  }
  if (seen.size === 0) return NextResponse.json({ error: '沒有選取品項' }, { status: 400 })
  if (seen.size > MAX) return NextResponse.json({ error: `一次最多 ${MAX} 個品項，請縮小範圍` }, { status: 400 })
  const imageUrl = entries[0]?.imageUrl ?? ''
  const imageCount = new Set(entries.map((e) => e.imageUrl)).size

  try {
    const result = await setProductImagesBatch(entries, imageUrl, { overwrite, dryRun })
    if (!dryRun) {
      await logAuditEvent({
        module: 'products', action: 'update', entityType: 'product-image-batch', entityId: imageCount > 1 ? `${imageCount} 張圖` : imageUrl,
        summary: `批次設定產品圖片：${result.updated.length} 個品項（略過 ${result.skipped.length}、失敗 ${result.failed.length}）`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { imageUrl: imageCount > 1 ? `${imageCount} 張圖` : imageUrl, updated: result.updated, overwrite },
        metadata: { skipped: result.skipped.length, failed: result.failed, unknown },
      }).catch((e) => console.error('audit product image batch error:', e))
    }
    return NextResponse.json({ dryRun, ...result, unknown })
  } catch (error: any) {
    console.error('[products/images/batch]', error)
    return NextResponse.json({ error: error?.message ?? '批次設定失敗' }, { status: 500 })
  }
})
