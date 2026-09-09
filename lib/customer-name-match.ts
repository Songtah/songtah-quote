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

/** 機構類型後綴：比對時一律剝除 */
const SUFFIXES = /(牙醫診所|牙體技術所|牙科診所|齒科診所|牙醫聯合診所|聯合診所|牙體技術|牙技所|鑲牙所|技工所|技術所|牙醫|牙科|齒科|診所|醫院|工作室|有限公司|股份有限公司|公司|所)$/

/** 地名前綴：日報常寫「桃園致臻」，主檔只有「致臻」 */
const CITY_PREFIX = /^(基隆|台北|臺北|新北|桃園|新竹|苗栗|台中|臺中|彰化|南投|雲林|嘉義|台南|臺南|高雄|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)(市|縣)?/

/**
 * 取比對用的字根：全形轉半形空白、台/臺統一、去括號與空白、剝地名前綴與機構後綴。
 * 後綴可能疊寫（「○○牙醫診所」剝完是「○○」），故重複剝到不再變化為止。
 */
export function customerNameStem(name: string): string {
  let s = (name ?? '')
    .replace(/臺/g, '台')
    .replace(/[（）()\[\]【】\s\-_・･·]/g, '')
    .trim()
  s = s.replace(CITY_PREFIX, '') || s
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIXES, '')
    if (next === s || next.length < 2) break   // 剝到剩 1 字就停，避免過度剝離
    s = next
  }
  return s
}

/** 兩個名稱是否指同一家：字根相同，或其中一方的字根完整包含另一方（且夠長不致誤判） */
export function isSameCustomerName(a: string, b: string): boolean {
  const x = customerNameStem(a), y = customerNameStem(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 2 && long.includes(short)
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
