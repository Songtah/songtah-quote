/**
 * POST /api/events/[id]/forms/image —— 上傳問卷「關聯產品」題的產品圖片到 Vercel Blob，回傳網址。
 * 限制比照活動廣告圖：JPG/PNG/WebP、4 MB 以內。問卷設定只收 Blob 網域的圖片網址（lib/event-forms-model）。
 */
import { put } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { withApiAuth } from '@/lib/api-auth'
import { getEventById } from '@/lib/notion/events'

export const dynamic = 'force-dynamic'
const MAX_SIZE = 4 * 1024 * 1024
const ALLOWED = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])

export const POST = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }) => {
  const event = await getEventById(params.id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: '無效的表單資料' }, { status: 400 }) }
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })
  const ext = ALLOWED.get(file.type)
  if (!ext) return NextResponse.json({ error: '只支援 JPG、PNG、WebP 格式' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: '圖片大小不能超過 4 MB' }, { status: 400 })
  try {
    const blob = await put(`event-forms/${params.id.replace(/-/g, '')}/${Date.now()}-${crypto.randomUUID()}.${ext}`, file, { access: 'public' })
    return NextResponse.json({ url: blob.url })
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    console.error('[event-form-image]', msg)
    if (msg.includes('BLOB_READ_WRITE_TOKEN') || msg.includes('token')) return NextResponse.json({ error: '圖片儲存服務未設定，請通知管理員。' }, { status: 503 })
    return NextResponse.json({ error: `上傳失敗：${msg.slice(0, 120)}` }, { status: 500 })
  }
})
