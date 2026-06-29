/**
 * POST /api/assets/upload
 *
 * Accepts a single image file (multipart/form-data, field "file")
 * and an optional "folder" param: "originals" | "compressed" (default "originals").
 * Stores under assets/{folder}/{timestamp}-{random}.{ext} in Vercel Blob.
 * Returns { url }.
 */

import { put } from '@vercel/blob'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_SIZE   = 4 * 1024 * 1024   // 4 MB (Vercel serverless body limit is 4.5 MB)
const ALLOWED    = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '無效的表單資料' }, { status: 400 })
  }

  const file   = formData.get('file')   as File   | null
  const folder = (formData.get('folder') as string | null) ?? 'originals'

  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })

  if (!ALLOWED.has(file.type))
    return NextResponse.json({ error: '只支援 JPG、PNG、WebP、GIF 格式' }, { status: 400 })

  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: '圖片大小不能超過 20 MB' }, { status: 400 })

  const safePath = ['originals', 'compressed'].includes(folder) ? folder : 'originals'
  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const blobPath = `assets/${safePath}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  try {
    const blob = await put(blobPath, file, { access: 'public', allowOverwrite: true })
    return NextResponse.json({ url: blob.url })
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    console.error('[assets/upload]', msg)
    if (msg.includes('BLOB_READ_WRITE_TOKEN') || msg.includes('token'))
      return NextResponse.json({ error: '圖片儲存服務未設定，請通知管理員。' }, { status: 503 })
    if (msg.includes('private'))
      return NextResponse.json({ error: 'Blob 儲存空間設定錯誤（private store）。' }, { status: 503 })
    return NextResponse.json({ error: `上傳失敗：${msg.slice(0, 120)}` }, { status: 500 })
  }
}
