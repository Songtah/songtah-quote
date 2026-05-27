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

export const dynamic = 'force-dynamic'

const MAX_SIZE   = 20 * 1024 * 1024   // 20 MB (originals can be large)
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
  const blobPath = `assets/${safePath}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  try {
    const blob = await put(blobPath, file, { access: 'public' })
    return NextResponse.json({ url: blob.url })
  } catch (err: any) {
    if (err?.message?.includes('BLOB_READ_WRITE_TOKEN')) {
      return NextResponse.json(
        { error: '尚未設定 Vercel Blob 儲存空間，請至 Vercel 後台啟用 Blob Storage。' },
        { status: 503 },
      )
    }
    console.error('[assets/upload]', err)
    return NextResponse.json({ error: '上傳失敗，請稍後再試' }, { status: 500 })
  }
}
