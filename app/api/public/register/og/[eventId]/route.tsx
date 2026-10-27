/**
 * GET /api/public/register/og/[活動 id] —— 報名頁分享預覽圖（LINE／Facebook 的 og:image）
 *
 * 廣告圖比例不固定（例：2000×770 的長橫幅），但 LINE／Facebook 分享卡固定約 1.91:1（1200×630），
 * 直接給原圖會被裁掉左右兩側（logo、講師）。這裡把整張廣告圖等比放進 1200×630：
 * 背景鋪同一張圖並壓暗，上面放完整原圖，空白處看起來是圖片自然延伸。
 *
 * 公開例外（同報名頁）：只在活動有開放線上報名時回圖，且只抓本系統 Vercel Blob 上的圖片（防 SSRF，
 * 廣告圖只能經上傳 API 寫入，見 app/api/events/[id]/banner）。
 */
import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { getEventById } from '@/lib/notion/events'

export const dynamic = 'force-dynamic'

const W = 1200
const H = 630

function isOwnBlob(url: string) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch {
    return false
  }
}

export async function GET(req: Request, { params }: { params: { eventId: string } }) {
  const event = await getEventById(params.eventId).catch(() => null)
  const banner = event?.onlineRegistration ? event.bannerUrl : ''
  if (!banner || !isOwnBlob(banner)) return new NextResponse('Not found', { status: 404 })
  // v 必須等於目前廣告圖檔名（報名頁 metadata 就是這樣產生的）：亂帶 v 會繞過 CDN 快取、每次重新產圖，直接拒絕
  if (new URL(req.url).searchParams.get('v') !== banner.split('/').pop()) return new NextResponse('Not found', { status: 404 })
  // 產圖元件不支援 WebP：直接給原圖（分享卡會裁切，但至少有圖）
  if (/\.webp($|\?)/i.test(banner)) return NextResponse.redirect(banner)

  const img = await fetch(banner).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  if (!img) return new NextResponse('Not found', { status: 404 })
  const src = `data:${/\.png($|\?)/i.test(banner) ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(img).toString('base64')}`

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', position: 'relative', background: '#1c1917' }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={src} width={W} height={H} style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover', opacity: 0.35 }} />
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={src} width={W} height={H} style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'contain' }} />
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
  )
}
