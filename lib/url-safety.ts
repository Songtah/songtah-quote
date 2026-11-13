/**
 * lib/url-safety.ts — 伺服器端要 fetch「使用者可控網址」前的唯一檢查（防 SSRF）。
 * 只放行 https、非私網位址，且主機名稱必須符合呼叫端給的白名單。
 * （原本放在已移除的 /api/notion-image；Notion 封存後改成共用 helper。）
 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /^\[?fc[0-9a-f]{2}:/i, /^\[?fe80:/i,
]

export function isUrlSafeToProxy(rawUrl: string, allowedHosts: RegExp[]): boolean {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return false
  return allowedHosts.some((re) => re.test(host))
}
