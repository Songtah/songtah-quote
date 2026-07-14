/**
 * POST /api/products/upload-doc
 *
 * Accepts a single document file (multipart/form-data, field "file").
 * Stores under product-docs/{timestamp}-{random}.{ext} in Vercel Blob.
 * Returns { url, name, size }.
 *
 * Supported: PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP
 * Max size: 4 MB (Vercel serverless body limit is 4.5 MB)
 */

import { put } from '@vercel/blob'
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024  // 4 MB

const ALLOWED_TYPES = new Set([
  'application/pdf',
  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text / CSV
  'text/plain',
  'text/csv',
  'application/csv',
  // ZIP / RAR
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/octet-stream',   // some browsers send this for .docx/.xlsx
])

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '無效的表單資料' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '未收到檔案' }, { status: 400 })

  // Accept by extension as a fallback (browser MIME types can vary)
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? ''
  const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z'])
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { error: '不支援的檔案格式，請上傳 PDF、Word、Excel、PowerPoint、TXT 或 ZIP' },
      { status: 400 },
    )
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `檔案大小不能超過 4 MB（目前 ${(file.size / 1024 / 1024).toFixed(1)} MB）` }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._\-一-鿿]/g, '_')
  const blobPath = `product-docs/${Date.now()}-${crypto.randomUUID()}-${safeName}`

  try {
    const blob = await put(blobPath, file, { access: 'public', allowOverwrite: true })
    return NextResponse.json({ url: blob.url, name: file.name, size: file.size })
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    console.error('[upload-doc]', msg)
    if (msg.includes('BLOB_READ_WRITE_TOKEN') || msg.includes('token'))
      return NextResponse.json({ error: '儲存服務未設定，請通知管理員。' }, { status: 503 })
    return NextResponse.json({ error: `上傳失敗：${msg.slice(0, 120)}` }, { status: 500 })
  }
})
