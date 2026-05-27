/**
 * GET  /api/assets           → list brand assets (optional ?category=xxx)
 * POST /api/assets           → create asset record in Notion
 */

import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import {
  listAssets,
  createAsset,
  isAssetsDbConfigured,
} from '@/lib/assets-notion'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAssetsDbConfigured()) {
    return NextResponse.json({ error: 'NOTION_ASSETS_DB 尚未設定', setup: true }, { status: 503 })
  }

  const category = req.nextUrl.searchParams.get('category') ?? undefined
  const assets   = await listAssets(category)
  return NextResponse.json(assets)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAssetsDbConfigured()) {
    return NextResponse.json({ error: 'NOTION_ASSETS_DB 尚未設定', setup: true }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const { name, category, tags, compressedUrl, originalUrl, originalSize, compressedSize } = body

  if (!name?.trim() || !compressedUrl || !originalUrl) {
    return NextResponse.json({ error: '缺少必要欄位（name、compressedUrl、originalUrl）' }, { status: 400 })
  }

  const user = session.user as any
  const uploadedBy = user?.name || user?.email || '未知'

  const asset = await createAsset({
    name:           name.trim(),
    category:       category || '其他',
    tags:           Array.isArray(tags) ? tags : [],
    compressedUrl,
    originalUrl,
    originalSize:   Number(originalSize)   || 0,
    compressedSize: Number(compressedSize) || 0,
    uploadedBy,
  })

  return NextResponse.json(asset, { status: 201 })
}
