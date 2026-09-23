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

/**
 * 標案品類：從標案名稱判斷這是在買什麼。
 * 用途是看市場結構（誰在賣什麼、我們有沒有在那個品類裡），不是精準分類，
 * 所以採「先命中先算」的順序：越具體的品類排越前面。
 */
export const TENDER_CATEGORIES = [
  // 先判「不是在買東西」的案子，否則「牙科支援醫師」會被後面的設備詞吃掉
  ['醫療服務', /支援醫師|駐診|專科醫師|醫師\s*\d*\s*名|甄審|醫療合作|巡迴|外展|照護|篩檢|檢查|保健計畫|防治|宣導|衛教|指引|襄助|委託計畫/],
  ['教學研究', /教學用|教學儀器|實驗桌|系館|學系|研究用|實習/],
  ['工程修繕', /工程|整修|裝修|修繕/],
  ['數位設備', /口掃|口內掃描|掃[瞄描]機|3D列印|列印機|切削|燒結|CAD|CAM|數位化|模型掃描/i],
  ['影像設備', /X\s*光|X-?ray|全景|環口|斷層|CT|根尖.*(機|片)|洗片機|影像|攝影/i],
  ['診療設備', /治療椅|治療台|診療椅|診療台|牙科椅|雷射|顯微鏡|光固化|沖牙|吸唾|壓縮機|純水機|滅菌|高壓蒸氣|笑氣|止痛氣體|治療設備|牙科設備|設備/],
  ['義齒技工', /義齒|假牙|牙冠|贋復|牙體技術|技工|活動假牙|全口重建|矯正器|隱形矯正|牙托/],
  ['牙材耗材', /醫材|衛材|牙材|耗材|器械|車針|印模|材料|根管|植體|骨釘|骨板|填補|樹脂|開口器|鑷|單價.*契約|開口契約/],
  ['資訊軟體', /軟體|系統|資訊|平台|EXOCAD|雲端|管理系統/i],
  ['維護保養', /維護|保養|維修|全責|檢測校正/],
] as const

export function classifyTender(title: string): string {
  for (const [name, re] of TENDER_CATEGORIES) if (re.test(title)) return name
  return '其他'
}

/** 機關類型：看採購來源的結構（醫學中心？衛生所？學校？） */
export function classifyBuyer(unitName: string): string {
  if (/榮民總醫院|大學.*醫院|醫學院.*醫院|醫學大學/.test(unitName)) return '醫學中心／大學醫院'
  if (/衛生所/.test(unitName)) return '衛生所'
  if (/衛生局|縣政府|市政府|鄉公所|鎮公所/.test(unitName)) return '地方政府'
  if (/醫院/.test(unitName)) return '醫院'
  if (/大學|學校|專科|高中|高工|科技大學/.test(unitName)) return '學校'
  if (/監獄|矯正|看守所|戒治所/.test(unitName)) return '矯正機關'
  if (/國軍|軍醫|國防/.test(unitName)) return '軍方'
  if (/衛生福利部|健保署|國家衛生研究院|疾病管制署/.test(unitName)) return '中央機關'
  return '其他'
}
