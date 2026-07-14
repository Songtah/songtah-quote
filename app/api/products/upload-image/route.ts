import { put } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import crypto from 'crypto'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024  // 4 MB (Vercel serverless body limit is 4.5 MB; leave headroom for multipart overhead)
const ALLOWED  = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export const POST = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '無效的表單資料' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })

  if (!ALLOWED.has(file.type))
    return NextResponse.json({ error: '只支援 JPG、PNG、WebP、GIF 格式' }, { status: 400 })

  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: '圖片大小不能超過 5 MB' }, { status: 400 })

  // Sanitise filename
  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safeName = `products/${Date.now()}-${crypto.randomUUID()}.${ext}`

  try {
    const blob = await put(safeName, file, { access: 'public', allowOverwrite: true })
    await logAuditEvent({
      module: 'products', action: 'upload', entityType: 'product-image', entityId: safeName,
      entityTitle: file.name, summary: `上傳產品圖片：${file.name}`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      metadata: { contentType: file.type, size: file.size },
    }).catch((error) => console.error('audit product image upload error:', error))
    return NextResponse.json({ url: blob.url })
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    console.error('[upload-image]', msg)
    if (msg.includes('BLOB_READ_WRITE_TOKEN') || msg.includes('token'))
      return NextResponse.json({ error: '圖片儲存服務未設定，請通知管理員。' }, { status: 503 })
    if (msg.includes('private'))
      return NextResponse.json({ error: 'Blob 儲存空間設定錯誤（private store）。' }, { status: 503 })
    return NextResponse.json({ error: `上傳失敗：${msg.slice(0, 120)}` }, { status: 500 })
  }
})
