/**
 * Notion Image Proxy
 *
 * Tries to find a product image in this order:
 * 1. Page cover image (page.cover)
 * 2. First image block in page content (top-level blocks)
 *
 * In-memory cache (30 min) prevents hammering Notion on bulk loads.
 *
 * Usage: /api/notion-image?pageId=<notionPageId>
 */

import { Client } from '@notionhq/client'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

// Cache: pageId → { url | null, expiresAt }
const imageCache = new Map<string, { url: string | null; expiresAt: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

function getCached(pageId: string): string | null | undefined {
  const entry = imageCache.get(pageId)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) { imageCache.delete(pageId); return undefined }
  return entry.url
}

function setCache(pageId: string, url: string | null) {
  imageCache.set(pageId, { url, expiresAt: Date.now() + CACHE_TTL })
}

function extractFileOrExternalUrl(obj: any): string {
  if (!obj) return ''
  if (obj.type === 'external') return obj.external?.url ?? ''
  if (obj.type === 'file') return obj.file?.url ?? ''
  // direct object with external/file sub-keys
  if (obj.external?.url) return obj.external.url
  if (obj.file?.url) return obj.file.url
  return ''
}

// 僅允許代理 Notion 自家檔案儲存（file 類型一定落在這些網域）；external 類型可能是任意網址，
// 拒絕代理避免成為開放代理 / SSRF 跳板（攻擊者可透過 Notion 編輯權限把圖片網址指向內部服務）。
const ALLOWED_IMAGE_HOSTS = [/\.amazonaws\.com$/i, /(^|\.)notion\.so$/i, /(^|\.)notion-static\.com$/i]
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /^\[?fc[0-9a-f]{2}:/i, /^\[?fe80:/i,
]

function isUrlSafeToProxy(rawUrl: string): boolean {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return false
  return ALLOWED_IMAGE_HOSTS.some((re) => re.test(host))
}

/** Stream the image from the given URL back to the client. */
async function streamImage(url: string): Promise<NextResponse> {
  if (!isUrlSafeToProxy(url)) {
    return new NextResponse('Image source not allowed', { status: 400 })
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return new NextResponse('Upstream fetch failed', { status: 502 })
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  return new NextResponse(res.body as any, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=1800',
    },
  })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) return new NextResponse('Missing pageId', { status: 400 })

  // Serve from cache if available
  const cached = getCached(pageId)
  if (cached !== undefined) {
    if (!cached) return new NextResponse('No image', { status: 404 })
    return streamImage(cached)
  }

  try {
    // 1. Check page cover image
    const page: any = await notion.pages.retrieve({ page_id: pageId })
    if (page.cover) {
      const url = extractFileOrExternalUrl(page.cover)
      if (url) {
        setCache(pageId, url)
        return streamImage(url)
      }
    }

    // 2. Check page content blocks for an image block
    const blocks: any = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 50,
    })

    const imageBlock = (blocks.results ?? []).find(
      (block: any) => block.type === 'image'
    )

    if (imageBlock) {
      const url = extractFileOrExternalUrl(imageBlock.image)
      if (url) {
        setCache(pageId, url)
        return streamImage(url)
      }
    }

    // No image found
    setCache(pageId, null)
    return new NextResponse('No image found', { status: 404 })
  } catch (err) {
    console.error('notion-image proxy error:', err)
    return new NextResponse('Image fetch failed', { status: 500 })
  }
}
