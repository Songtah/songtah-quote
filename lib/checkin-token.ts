/**
 * 展會簽到連結簽章。簽到頁是公開頁（訪客未登入），連結帶 ?t= 簽章，
 * 防止有人拿任意活動 id 灌假簽到。密鑰沿用 NEXTAUTH_SECRET；未設定一律拒絕（fail-closed）。
 */
import { createHmac, timingSafeEqual } from 'crypto'

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET || null
}

export function signCheckinToken(eventId: string): string | null {
  const s = secret()
  if (!s) return null
  return createHmac('sha256', s).update(`checkin:${eventId.replace(/-/g, '')}`).digest('hex').slice(0, 24)
}

export function verifyCheckinToken(eventId: string, token: string): boolean {
  const expected = signCheckinToken(eventId)
  if (!expected || !token) return false
  const a = Buffer.from(expected), b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 活動日前 1 天到結束日後 1 天（台北）可簽到，避免舊 QR 被長期濫用 */
export function isCheckinOpen(event: { date: string; endDate?: string }, now = Date.now()): boolean {
  if (!event.date) return false
  const today = new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
  const shift = (d: string, days: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + days * 86400e3).toISOString().slice(0, 10)
  return today >= shift(event.date.slice(0, 10), -1) && today <= shift((event.endDate || event.date).slice(0, 10), 1)
}
