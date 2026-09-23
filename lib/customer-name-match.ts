/**
 * 客戶名稱比對 —— 客情紀錄的簡稱對照客戶主檔。
 *
 * 為什麼需要：LINE 日報寫的是口語簡稱，主檔寫的是正式名稱，差別幾乎都在後綴——
 * 「誠鴻牙科」vs「誠鴻牙醫診所」、「京禾技工所」vs「京禾牙體技術所」。
 * 原本 auto-link 直接拿整串簡稱做 contains 比對，這類一律對不到
 * （實測 120 筆待關聯紀錄成功 0 筆、全部落在「找不到客戶」）。
 *
 * 更危險的是反向：searchSystemCustomers 連「地址」「行政區」都納入比對，
 * 所以「久康」會撈到地址剛好含這兩字的無關客戶（實測回傳立新牙體技術所、童芯牙醫診所）。
 * auto-link 在「剛好 1 筆」時完全沒驗名稱就建立關聯並覆寫單位名稱，
 * 等於把客情紀錄接到錯的客戶身上。因此本檔提供的 stem 比對必須用在**每一條**路徑上，
 * 不能只在候選 >1 時才驗。
 */

import { stripPlaceNames, placeTokensIn } from './tw-places'

/**
 * 異體字／輸入法誤植：LINE 手機輸入常打出另一個字形，主檔是正式字形。
 * 實測未關聯紀錄裡的「立悦／千悦／悦暘」（悦 U+60A6 vs 悅 U+6085）、「鈦ㄧ／佳ㄧ」（注音ㄧ vs 國字一）、
 * 「龍安牙体」「新逹」「雲啓」都是這類，字根完全對得上卻因為一個字形不同而配不到。
 */
const GLYPH: Record<string, string> = { '悦': '悅', '体': '體', 'ㄧ': '一', '啓': '啟', '逹': '達', '臺': '台' }
const normalizeGlyphs = (s: string) => s.replace(/[悦体ㄧ啓逹臺]/g, (ch) => GLYPH[ch] ?? ch)

/** 機構類型後綴：比對時一律剝除 */
const SUFFIXES = /(牙醫診所|牙體技術所|牙科診所|齒科診所|牙醫聯合診所|聯合診所|牙體技術|牙技所|鑲牙所|技工所|技術所|牙醫|牙科|齒科|診所|醫院|工作室|有限公司|股份有限公司|公司|所)$/

/** 地名前綴：日報常寫「桃園致臻」，主檔只有「致臻」 */
const CITY_PREFIX = /^(基隆|台北|臺北|新北|桃園|新竹|苗栗|台中|臺中|彰化|南投|雲林|嘉義|台南|臺南|高雄|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)(市|縣)?/

/**
 * 取比對用的字根：全形轉半形空白、台/臺統一、去括號與空白、剝地名前綴與機構後綴。
 * 後綴可能疊寫（「○○牙醫診所」剝完是「○○」），故重複剝到不再變化為止。
 */
export function customerNameStem(name: string): string {
  let s = normalizeGlyphs(name ?? '')
    // 括號裡是聯絡人或補充說明（「虹霖牙醫診所(陳院長)」「禾玥牙醫診所(欣美牙醫診所)」），不是名稱的一部分；
    // 舊版只刪括號符號、保留內容，字根變成「虹霖陳院長」，實測 178 筆因此對不上
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/[（）()\[\]【】\s\-_・･·]/g, '')
    .trim()
  s = s.replace(CITY_PREFIX, '') || s
  // 名稱尾巴黏著動作（「三雅牙體技術所拜訪」「悅心牙醫診所場勘」）
  s = s.replace(/(拜訪|送貨|場勘|交機|裝機|收款|教學|維修|報價)+$/, '') || s
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIXES, '')
    if (next === s || next.length < 2) break   // 剝到剩 1 字就停，避免過度剝離
    s = next
  }
  return s
}

/**
 * 產生要拿去客戶庫搜尋的字串（依序嘗試，查到就停）。
 * 客戶庫搜尋是 Notion 文字比對，不認得異體字與地名前綴，所以要替它展開：
 *   原字串 → 字根 → 去掉地名的字根（「林口勤美」→「勤美」）→ 異體字另一種寫法（主檔也可能用「悦」「臺」）
 * 搜尋只負責撈候選，最後仍一律經 isSameCustomerName 驗證，不會因此放寬比對。
 */
export function searchVariants(name: string): string[] {
  const stem = customerNameStem(name)
  const out = [name.trim(), stem, stripPlaceNames(stem), stem.replace(/悅/g, '悦'), stem.replace(/台/g, '臺')]
  return Array.from(new Set(out.filter((v) => v && v.length >= 2)))
}

export type InstitutionKind = 'lab' | 'hospital' | 'clinic' | ''

/** 從名稱看得出的機構類型；看不出來回空字串（此時不拿類型擋） */
export function institutionKind(name: string): InstitutionKind {
  const s = normalizeGlyphs(name ?? '')
  if (/牙體|牙技|技工|齒模|技術所|鑲牙|齒藝/.test(s)) return 'lab'
  if (/醫院|院區|分院|總院|醫學大學|醫學中心|榮總|附設/.test(s)) return 'hospital'
  if (/牙醫|牙科|診所|齒科/.test(s)) return 'clinic'
  return ''
}

/**
 * 兩個名稱是否指同一家。規則由 5,704 筆已關聯紀錄反推（見 docs/rules/visit-customer-matching.md）：
 *   1. 兩邊都看得出機構類型時，類型必須一致——「元華牙體」不是「元華牙醫診所」、
 *      「成大醫院技工室」不是「成大牙醫診所」（實測曾被誤配）
 *   2. 字根相同 → 同一家
 *   3. 一方包含另一方時，多出來的字只能是地名（「林口勤美」＝「勤美」），
 *      或較短的字根至少 3 個字（「三軍總」＝「三軍總醫院附設…」）。
 *      兩字字根＋多出非地名的字一律不算：「德科維」≠「科維」、「慈濟新店」≠「濟新」
 */
export function isSameCustomerName(a: string, b: string): boolean {
  const ka = institutionKind(a), kb = institutionKind(b)
  if (ka && kb && ka !== kb) return false
  const x = customerNameStem(a), y = customerNameStem(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length < 2 || !long.includes(short)) return false
  if (short.length >= 3) return true
  return stripPlaceNames(long.replace(short, '')) === ''
}

/**
 * 從候選中挑出唯一相符者；不唯一（0 個或多個）一律回 null——寧可漏，不可錯掛。
 */
export function pickUniqueCustomerMatch<T extends { name: string }>(
  rawName: string, candidates: T[],
): T | null {
  const hits = candidates.filter((c) => isSameCustomerName(rawName, c.name))
  return hits.length === 1 ? hits[0] : null
}

// ── 用業務脈絡消歧義 ─────────────────────────────────────────────────────────
//
// 名稱字根在主檔大量重複（兩字字根 5,174 個裡 1,086 個重複：全美 14 家、微笑 13、陽明 13），
// 所以「候選不唯一就放棄」在實測 824 筆未配對紀錄中放掉了 457 筆。
// 日報本身帶著「誰回報的」，順著這條線可以縮小候選——由強到弱四層，
// 縮到剩一家才採用，縮不到唯一仍然放棄（不錯掛的原則不變）。

export type MatchNarrowing = {
  /** 該業務的轄區鍵「縣市|行政區」 */
  territories?: Set<string>
  /** 該業務轄區涵蓋的縣市 */
  territoryCities?: Set<string>
  /** 該業務實際活動的縣市（未設轄區者的替代訊號） */
  activeCities?: Set<string>
  /** 該業務曾拜訪過的客戶 id（去連字號） */
  visitedCustomerIds?: Set<string>
}

export type MatchCandidate = { id: string; name: string; city?: string; district?: string }

export type MatchOutcome<T> = {
  /** 命中唯一客戶才有值 */
  match: T | null
  /** 判定說明，會寫進客情的「配對說明」供稽核：例「轄區相符：臺北市大安區」 */
  reason: string
  /** 通過名稱字根驗證的候選（供「待確認配對」清單顯示選項） */
  candidates: T[]
}

const normId = (id: string) => (id ?? '').replace(/-/g, '')

/**
 * 名稱比對 ＋ 業務脈絡消歧義。narrow 未給（或該業務沒有任何脈絡）時，行為與
 * pickUniqueCustomerMatch 完全相同，所以可以安全地逐一替換呼叫點。
 */
/**
 * 名稱裡多寫的地名必須和客戶所在地一致：「泰山微美牙技所」可以是新北泰山的微美，
 * 不能是桃園龜山的微美牙技所（實測曾被這樣配到）。客戶沒有地址資料時不擋。
 */
function placeConsistent(rawName: string, c: MatchCandidate): boolean {
  const typed = customerNameStem(rawName), mine = customerNameStem(c.name)
  const extra = placeTokensIn(typed).filter((p) => !mine.includes(p))
  if (extra.length === 0 || (!c.city && !c.district)) return true
  const where = `${c.city ?? ''}${c.district ?? ''}`.replace(/臺/g, '台')
  return extra.every((p) => where.includes(p.replace(/臺/g, '台')))
}

export function pickCustomerMatch<T extends MatchCandidate>(
  rawName: string, candidates: T[], narrow?: MatchNarrowing,
): MatchOutcome<T> {
  const hits = candidates.filter((c) => isSameCustomerName(rawName, c.name) && placeConsistent(rawName, c))
  if (hits.length === 0) return { match: null, reason: '查無名稱相符的客戶', candidates: [] }
  if (hits.length === 1) return { match: hits[0], reason: '名稱唯一相符', candidates: hits }
  if (!narrow) return { match: null, reason: `名稱相符 ${hits.length} 家，無法判斷`, candidates: hits }

  const layers: { pick: (list: T[]) => T[]; label: (c: T) => string }[] = [
    {
      pick: (list) => list.filter((c) => c.city && c.district &&
        narrow.territories?.has(`${c.city}|${c.district}`)),
      label: (c) => `轄區相符：${c.city}${c.district}`,
    },
    {
      pick: (list) => list.filter((c) => c.city && narrow.territoryCities?.has(c.city)),
      label: (c) => `轄區縣市相符：${c.city}`,
    },
    {
      pick: (list) => list.filter((c) => c.city && narrow.activeCities?.has(c.city)),
      label: (c) => `業務活動縣市相符：${c.city}`,
    },
    {
      pick: (list) => list.filter((c) => narrow.visitedCustomerIds?.has(normId(c.id))),
      label: () => '該業務過去拜訪過這家',
    },
  ]

  let pool = hits
  for (const layer of layers) {
    const next = layer.pick(pool)
    if (next.length === 1) return { match: next[0], reason: layer.label(next[0]), candidates: hits }
    if (next.length > 1) pool = next          // 縮小後仍多筆 → 帶著較小的池子往下一層
  }
  return { match: null, reason: `名稱相符 ${hits.length} 家，脈絡仍無法判斷`, candidates: hits }
}
