/**
 * 補告知同意連結的簽章：一筆問卷回覆一個連結，不能拿別人的回覆 id 亂點。
 * 密鑰沿用 NEXTAUTH_SECRET；未設定一律拒絕（fail-closed）。
 */
import { createHmac, timingSafeEqual } from 'crypto'

export function signConsentToken(responseId: string): string | null {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) return null
  return createHmac('sha256', s).update(`consent:${responseId.toLowerCase()}`).digest('hex').slice(0, 24)
}

export function verifyConsentToken(responseId: string, token: string): boolean {
  const expected = signConsentToken(responseId)
  if (!expected || !token) return false
  const a = Buffer.from(expected), b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
