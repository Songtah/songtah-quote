/**
 * lib/compliance/licenses.ts —— 牙科類醫療器材許可證索引（食藥署開放資料）
 * 由 scripts/build-device-licenses.py 產生 data/compliance/device-licenses-dental.json。
 * 限制：只含牙科學類別的「許可證」；登錄制品項與非牙科類不在內 → 查無一律回「未收錄」，不可當成無證。
 */
import 'server-only'
import fs from 'fs'
import path from 'path'

export type DeviceLicense = {
  no: string; st: string; exp: string; zh: string; en: string; eff: string
  app: string; mfr: string; cls: string; cat: string
}
type Index = { builtAt: string; licenses: DeviceLicense[]; byNo: Map<string, DeviceLicense> }

let cache: Index | null = null

/** 許可證字號正規化：去空白、全形轉半形 */
export function normalizeLicenseNo(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

function load(): Index {
  if (cache) return cache
  const file = path.join(process.cwd(), 'data', 'compliance', 'device-licenses-dental.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { builtAt: string; licenses: DeviceLicense[] }
  cache = { builtAt: raw.builtAt, licenses: raw.licenses, byNo: new Map(raw.licenses.map((l) => [normalizeLicenseNo(l.no), l])) }
  return cache
}

export const licenseIndexBuiltAt = () => load().builtAt

export function findLicense(no: string): DeviceLicense | null {
  return load().byNo.get(normalizeLicenseNo(no)) ?? null
}

/** 某公司（名稱含任一關鍵字）作為申請商持有的牙科類許可證 */
export function licensesByApplicant(names: string[]): DeviceLicense[] {
  const keys = names.map((n) => n.trim()).filter((n) => n.length >= 2)
  if (!keys.length) return []
  return load().licenses.filter((l) => keys.some((k) => l.app.includes(k)))
}

/** 許可證字號樣式（衛署／衛部 醫器 製／輸／陸輸 壹? 字第 000000 號） */
export const LICENSE_NO_RE = /衛[署部]醫器(?:製|輸|陸輸)(?:壹)?字第\s*[0-9０-９]{6}\s*號/g
/** 醫療器材廣告核准字號樣式（例：北市衛器廣字第…號、衛部醫器廣字第…號）；樣式由實例歸納，未窮盡 */
export const AD_APPROVAL_RE = /[一-龥]{1,4}(?:衛)?(?:醫)?器廣字第\s*[0-9０-９]{6,12}\s*號/g

export function licenseStatus(l: DeviceLicense, onDate: string): '有效' | '已註銷' | '已廢止' | '已逾期' {
  if (l.st === '已註銷' || l.st === '已廢止') return l.st
  const exp = l.exp.replace(/\//g, '-')
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && exp < onDate) return '已逾期'
  return '有效'
}
