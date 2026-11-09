/**
 * lib/compliance/capture.ts —— 擷取公開網頁並存證
 *
 * 只抓不需登入的公開頁面；不登入、不繞過驗證碼或登入牆。Facebook／Instagram 等有登入牆的平台只接受人工貼單篇網址，
 * 擷取不到內容時如實記錄，不做任何規避。
 * 存證＝原始回應位元組的 SHA-256＋原始 HTML 存檔（Vercel Blob）＋第三方存檔（Wayback Machine）。
 */
import 'server-only'
import crypto from 'crypto'
import { put } from '@vercel/blob'
import { AD_APPROVAL_RE, LICENSE_NO_RE, normalizeLicenseNo } from './licenses'
import { type Capture, type Target, type TargetSource, getLastTextHash, newId, saveCapture, setLastTextHash } from './store'

const PRIVATE_HOST = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^\[?::1\]?$/, /^\[?f[cd]/i, /\.local$/i, /\.internal$/i]
export function isSafePublicUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  return !PRIVATE_HOST.some((re) => re.test(u.hostname))
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAX_BYTES = 3_000_000

export const htmlToText = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

function decode(buf: Buffer, contentType: string): string {
  const head = buf.subarray(0, 2048).toString('latin1')
  const m = /charset=["']?([\w-]+)/i.exec(contentType) ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
  const cs = (m?.[1] ?? 'utf-8').toLowerCase()
  try { return new TextDecoder(cs === 'big5-hkscs' ? 'big5' : cs).decode(buf) } catch { return buf.toString('utf8') }
}

export type FetchedPage = { url: string; status: number; raw: Buffer; html: string; text: string; title: string }

/** 抓一頁；逐次手動跟隨轉址並對每一跳做網域檢查（防 SSRF） */
export async function fetchPage(url: string): Promise<FetchedPage | null> {
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    if (!isSafePublicUrl(current)) return null
    let res: Response
    try {
      res = await fetch(current, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
    } catch { return null }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      current = new URL(loc, current).toString()
      continue
    }
    const type = res.headers.get('content-type') ?? ''
    if (type && !/html|text|xml/i.test(type)) return null
    const raw = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES)
    const html = decode(raw, type)
    const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 120)
    return { url: current, status: res.status, raw, html, text: htmlToText(html), title }
  }
  return null
}

/** 從首頁找同網域的內頁；產品、消息、活動類優先 */
export function pickInternalLinks(page: FetchedPage, limit: number): string[] {
  const base = new URL(page.url)
  const seen = new Set<string>([page.url.replace(/#.*$/, '')])
  const scored: { url: string; score: number }[] = []
  for (const m of Array.from(page.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi))) {
    let u: URL
    try { u = new URL(m[1], page.url) } catch { continue }
    if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) continue
    if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js)(\?|$)/i.test(u.pathname)) continue
    const key = u.toString().replace(/#.*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const label = htmlToText(m[2]) + ' ' + u.pathname + u.search
    let score = 0
    if (/產品|商品|product|shop|item|catalog|型錄/i.test(label)) score += 3
    if (/最新消息|新聞|news|活動|優惠|促銷|event|blog|文章/i.test(label)) score += 2
    if (/關於|about|聯絡|contact|隱私|privacy|登入|login|購物車|cart|會員/i.test(label)) score -= 2
    scored.push({ url: key, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.url)
}

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

/** 存一頁的證據。內容與上次相同就不重複存（回 null）。 */
export async function storeCapture(target: Target, source: TargetSource, page: FetchedPage, opts: { force?: boolean } = {}): Promise<Capture | null> {
  const textSha256 = sha(page.text)
  if (!opts.force && (await getLastTextHash(page.url)) === textSha256) return null
  const id = newId()
  const capturedAt = new Date().toISOString()
  const token = process.env.BLOB_READ_WRITE_TOKEN
  let blobUrl = ''
  if (token) {
    // 路徑不帶對象名稱；現有 Blob 空間為公開存取，以隨機字尾避免被猜到
    const blob = await put(`cm/${capturedAt.slice(0, 10)}/${id}.html`, page.raw, { access: 'public', addRandomSuffix: true, contentType: 'application/octet-stream', token })
    blobUrl = blob.url
  }
  const uniq = (re: RegExp) => Array.from(new Set(Array.from(page.text.matchAll(re)).map((m) => normalizeLicenseNo(m[0]))))
  const capture: Capture = {
    id, targetId: target.id, sourceId: source.id, url: page.url, capturedAt, httpStatus: page.status,
    sha256: sha(page.raw), textSha256, bytes: page.raw.length, blobUrl, archiveUrl: '', title: page.title,
    licenseNos: uniq(LICENSE_NO_RE), adApprovalNos: uniq(AD_APPROVAL_RE),
  }
  await saveCapture(capture)
  await setLastTextHash(page.url, textSha256)
  return capture
}

/** 送第三方存檔（Wayback Machine）。對方常限流或逾時，失敗回 ''，不影響主流程。 */
export async function archiveToWayback(url: string): Promise<string> {
  if (!isSafePublicUrl(url)) return ''
  try {
    const res = await fetch(`https://web.archive.org/save/${url}`, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40000) })
    if (!res.ok) return ''
    return /^https:\/\/web\.archive\.org\/web\/\d+\//.test(res.url) ? res.url : ''
  } catch { return '' }
}

/** 讀回存證的原始 HTML 轉成文字（判讀一律以存證當時的內容為準，並重新驗證雜湊） */
export async function loadCaptureText(capture: Capture): Promise<string> {
  if (!capture.blobUrl) throw new Error('這筆存證沒有原始檔')
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(capture.blobUrl)) throw new Error('存證檔網址不在允許的網域')
  const res = await fetch(capture.blobUrl, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`存證檔讀取失敗（${res.status}）`)
  const raw = Buffer.from(await res.arrayBuffer())
  if (sha(raw) !== capture.sha256) throw new Error('存證檔雜湊不符，可能已遭變更')
  return htmlToText(decode(raw, ''))
}
