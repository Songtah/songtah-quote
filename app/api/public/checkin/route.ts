/**
 * POST /api/public/checkin —— 展會現場 QR 簽到（公開、未登入）
 *
 * withApiAuth 的明確例外（同 line/webhook、daily-report）：訪客沒有帳號。
 * 以四道防線取代登入：
 *   1. 連結簽章（lib/checkin-token）  2. 只在活動期間開放
 *   3. 每 IP 10 分鐘 30 次            4. honeypot 欄位＋欄位長度上限
 * 回應一律只說「簽到完成」，絕不回傳客戶配對結果或任何客戶資料。
 * 同一活動同一電話重複簽到不重建（掃兩次 QR 很常見）。
 * 客戶配對不在此同步執行（冷啟動要掃全客戶庫），由每小時排程 process-registrations 補上。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getEventById, createRegistration, listEventRegistrations } from '@/lib/notion/events'
import { getRedisValue, setRedisValue } from '@/lib/notion/shared'
import { verifyCheckinToken, isCheckinOpen } from '@/lib/checkin-token'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 30
const RATE_WINDOW_MS = 10 * 60_000
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: '資料格式錯誤' }, { status: 400 }) }

  // honeypot：真人看不到這個欄位
  if (clip(body?.website, 100)) return NextResponse.json({ ok: true })

  const eventId = clip(body?.eventId, 64)
  if (!eventId || !verifyCheckinToken(eventId, clip(body?.t, 64))) {
    return NextResponse.json({ error: '簽到連結無效，請向現場人員索取新的 QR code' }, { status: 403 })
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `checkin-rl:${ip}`
  const hits = (await getRedisValue<number>(rlKey)) ?? 0
  if (hits >= RATE_LIMIT) return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 })
  await setRedisValue(rlKey, hits + 1, RATE_WINDOW_MS)

  const institution = clip(body?.institution, 100)
  const contact = clip(body?.contact, 50)
  const phone = clip(body?.phone, 30)
  const city = clip(body?.city, 10)
  if (institution.length < 2 || !contact || phone.replace(/\D/g, '').length < 8) {
    return NextResponse.json({ error: '請填寫機構名稱、姓名與聯絡電話' }, { status: 400 })
  }

  const event = await getEventById(eventId)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  if (!isCheckinOpen(event)) return NextResponse.json({ error: '此活動目前不開放簽到' }, { status: 403 })

  try {
    const tail = phone.replace(/\D/g, '').slice(-8)
    const existing = await listEventRegistrations(eventId)
    const dup = existing.some((r) => r.status !== '取消' && r.phone.replace(/\D/g, '').slice(-8) === tail)
    if (!dup) {
      await createRegistration({
        eventId, institution, contact, phone, city,
        attendees: 1, status: '已到場', source: '展會簽到',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('public checkin error:', error)
    return NextResponse.json({ error: '簽到暫時失敗，請稍後再試或洽現場人員' }, { status: 500 })
  }
}
