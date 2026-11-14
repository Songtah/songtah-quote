/**
 * /api/public/consent/[responseId]?t=簽章 —— 問卷「補告知」公開頁（未登入）。
 * 告知頁上線前填寫問卷的人，收到補告知信後由這裡閱讀告知事項並勾選同意。
 * withApiAuth 的公開例外：以 HMAC 簽章（lib/consent-token）＋ IP 限流取代登入；只回活動名稱與遮罩後的姓名，不回其他個資。
 */
import { NextRequest, NextResponse } from 'next/server'
import { hitRateLimit } from '@/lib/notion/shared'
import { getEventById } from '@/lib/notion/events'
import { getResponseForConsent, recordRenoticeConsent } from '@/lib/db/event-forms'
import { verifyConsentToken } from '@/lib/consent-token'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacy-notice'

export const dynamic = 'force-dynamic'
type Ctx = { params: { responseId: string } }
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
const mask = (name: string) => (name ? name.slice(0, 1) + '〇'.repeat(Math.max(1, Math.min(2, name.length - 1))) : '')

async function load(req: NextRequest, id: string, token: string) {
  if (await hitRateLimit(`consent-rl:${ipOf(req)}`, 60, 10 * 60_000)) return { error: NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 }) }
  if (!verifyConsentToken(id, token)) return { error: NextResponse.json({ error: '連結無效或已過期，請洽崧達' }, { status: 403 }) }
  const found = await getResponseForConsent(id)
  if (!found) return { error: NextResponse.json({ error: '找不到這筆紀錄' }, { status: 404 }) }
  return { found }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { error, found } = await load(req, params.responseId, req.nextUrl.searchParams.get('t') ?? '')
  if (error) return error
  const event = await getEventById(found!.eventId).catch(() => null)
  const r = found!.response
  return NextResponse.json({ eventName: event?.name ?? '', formTitle: found!.formTitle, name: mask(r.name), consented: !!r.consentAt, consentAt: r.consentAt, marketing: r.marketingOptIn })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const body = await req.json().catch(() => null)
  const { error, found } = await load(req, params.responseId, typeof body?.t === 'string' ? body.t : '')
  if (error) return error
  if (body?.consent !== true) return NextResponse.json({ error: '請閱讀告知事項並勾選同意' }, { status: 400 })
  const r = await recordRenoticeConsent(found!.response.id, PRIVACY_NOTICE_VERSION, body?.marketing === true)
  if (!r) return NextResponse.json({ error: '儲存失敗，請稍後再試' }, { status: 500 })
  return NextResponse.json({ ok: true, consentAt: r.consentAt, marketing: r.marketingOptIn })
}
