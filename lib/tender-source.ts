/**
 * lib/tender-source.ts — 政府標案的共用型別與命中判定
 *
 * 抓取實作在 `lib/tender-pcc.ts`（政府電子採購網官網）與 `lib/tender-official.ts`（官方開放資料）。
 * 這裡只留「什麼算牙科標案」這件事——兩個來源共用同一套判定，才不會兩邊標準不一致。
 * （原本走 g0v／openfun 鏡像 API，但它對資料中心 IP 一律 403，正式站拿不到資料，已於 2026-09-22 移除。）
 *
 * ── 關鍵字為什麼要分兩級（實測）────────────────────────────────────────────
 * 「牙科」「齒模」「義齒」這類詞命中率高，直接收。
 * 但「3D列印機」全站 1,185 筆裡只有 6% 與牙科有關（其餘是海軍金屬列印、高工教學設備），
 * 「光固化」427 筆裡只有 4.3%。而「3D列印樹脂」是 0 筆——耗材根本不會這樣下標題。
 * 所以第二級關鍵字必須再通過「牙科情境」檢查才收：
 *   標題或機關名稱有牙科字樣／標的分類屬醫療類／機關是醫院、衛生所、牙體技術科系。
 * 這樣 1,185 筆會收斂到十幾筆，而且抓得到「樹人醫護 牙技科牙科用3D列印機組」這種真標案。
 *
 * ── 已知涵蓋範圍限制 ─────────────────────────────────────────────────────
 * 官網只能用標案名稱關鍵字查詢，所以標題沒寫關鍵字的案子仍會漏
 * （例：「115-118總分院醫材118項開口合約」其實含牙科品項）。
 * 之前逐日全量掃描可以 100% 涵蓋，但該來源已被擋；目前以關鍵字廣撒＋本地判定為準。
 */

/** 第一級：詞本身就代表牙科，直接收 */
export const TENDER_KEYWORDS_PRIMARY = [
  '牙科', '牙醫', '口腔', '齒模', '義齒', '假牙', '牙體技術', '植牙', '根管', '口掃', '贋復',
]

/** 第二級：我們賣的東西，但詞本身不限牙科 → 必須通過牙科情境檢查 */
export const TENDER_KEYWORDS_SECONDARY = [
  '3D列印機', '3D列印', '光固化', '樹脂', '列印耗材', '口內掃描', '掃描機', '切削機', '燒結爐', '咬合器',
]

/** 排除詞：字面像牙科、實際無關（齒輪箱油、獸醫牙科…） */
const EXCLUDE = /齒輪|齒條|齒盤|鋸齒|獸醫|動物醫院|犬貓/

/** 牙科情境：標題或機關名稱出現這些字，就算第二級關鍵字也採用 */
const DENTAL_CONTEXT = /牙|齒|口腔|贋復|義齒|植體/
/** 標的分類屬醫療類（例：財物類481-醫療,外科及矯形設備） */
const MEDICAL_CATEGORY = /醫療|外科|矯形|牙科/
/** 機關本身就是牙科買家 */
const DENTAL_BUYER = /醫院|衛生所|醫學院|牙醫|牙體|醫護|健康管理/

export type TenderRecord = {
  /** 去重鍵：機關代碼 + 案號 */
  id: string
  unitId: string
  jobNumber: string
  unitName: string
  title: string
  /** 公告類型：公開招標／公開取得報價單或企劃書／決標／無法決標… */
  type: string
  /** 公告日 YYYY-MM-DD */
  date: string
  category: string
  /** 命中的關鍵字 */
  matched: string[]
  tier: 1 | 2
  /** 以下來自明細，抓不到就留空 */
  budget: number | null
  budgetText: string
  deadline: string
  address: string
  city: string
  district: string
  contact: string
  phone: string
  url: string
  /** 決標公告才有：得標廠商、決標金額、底價、所有投標廠商（競爭對手情報） */
  winner: string
  awardAmount: number | null
  basePrice: number | null
  bidders: string[]
}

/** 第二級關鍵字的牙科情境檢查 */
export function isDentalContext(input: { title: string; unitName: string; category?: string }): boolean {
  if (DENTAL_CONTEXT.test(input.title)) return true
  if (DENTAL_CONTEXT.test(input.unitName)) return true
  if (input.category && MEDICAL_CATEGORY.test(input.category)) return true
  if (DENTAL_BUYER.test(input.unitName)) return true
  return false
}

/** 命中判定：回傳命中的關鍵字與級別；沒命中回 null */
export function matchKeywords(input: { title: string; unitName: string; category?: string }): { matched: string[]; tier: 1 | 2 } | null {
  const hay = `${input.title} ${input.unitName}`
  if (EXCLUDE.test(hay)) return null
  const primary = TENDER_KEYWORDS_PRIMARY.filter((k) => hay.includes(k))
  if (primary.length) return { matched: primary, tier: 1 }
  const secondary = TENDER_KEYWORDS_SECONDARY.filter((k) => hay.includes(k))
  if (secondary.length && isDentalContext(input)) return { matched: secondary, tier: 2 }
  return null
}
