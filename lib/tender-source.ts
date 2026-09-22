/**
 * lib/tender-source.ts — 政府標案來源（政府電子採購網）
 *
 * 資料來自 g0v／openfun 的標案 API（收集自行政院公共工程委員會政府電子採購網）。
 * 引用時註明出處；**商業利用應改用政府採購網的官方開放資料集**——第一期先用這支驗證價值，
 * 確定要長期用再換資料源（2026-09-22 與使用者確認的前提）。
 *
 * ── 關鍵字為什麼要分兩級（實測）────────────────────────────────────────────
 * 「牙科」「齒模」「義齒」這類詞命中率高，直接收。
 * 但「3D列印機」全站 1,185 筆裡只有 6% 與牙科有關（其餘是海軍金屬列印、高工教學設備），
 * 「光固化」427 筆裡只有 4.3%。而「3D列印樹脂」是 0 筆——耗材根本不會這樣下標題。
 * 所以第二級關鍵字必須再通過「牙科情境」檢查才收：
 *   標題或機關名稱有牙科字樣／標的分類屬醫療類／機關是醫院、衛生所、牙體技術科系。
 * 這樣 1,185 筆會收斂到十幾筆，而且抓得到「樹人醫護 牙技科牙科用3D列印機組」這種真標案。
 *
 * ── 完整性：改用「逐日全量」而非關鍵字搜尋（2026-09-22）──────────────────────
 * 關鍵字搜尋只比對標案「標題」，而且分頁有上限，必然漏掉標題沒寫關鍵字的案子
 * （例：「115-118總分院醫材118項開口合約」其實含牙科品項）。
 * 改為呼叫 listbydate 逐日取得**當日全部公告**（實測 2026-09-22 共 1,939 筆），
 * 在本地端用同一套兩級關鍵字＋情境規則過濾——一天一個請求，涵蓋率 100%。
 * 每日排程只抓「上次抓到之後的日期」，所以日常成本是 1～3 個請求。
 */

const API = 'https://pcc-api.openfun.app/api'

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const toDate = (n: number | string) => {
  const s = String(n ?? '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''
}

const parseMoney = (text: string): number | null => {
  const m = (text ?? '').replace(/,/g, '').match(/(\d+)\s*元/)
  return m ? Number(m[1]) : null
}

const parseArea = (addr: string): { city: string; district: string } => {
  const city = addr.match(/(台北市|臺北市|新北市|基隆市|桃園市|新竹市|新竹縣|苗栗縣|台中市|臺中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/)?.[1] ?? ''
  const district = addr.match(/[市縣]\s*([一-龥]{1,3}[區鄉鎮市])/)?.[1] ?? ''
  return { city: city.replace(/台/, '臺'), district }
}

/** 第二級關鍵字的牙科情境檢查 */
export function isDentalContext(input: { title: string; unitName: string; category?: string }): boolean {
  if (DENTAL_CONTEXT.test(input.title)) return true
  if (DENTAL_CONTEXT.test(input.unitName)) return true
  if (input.category && MEDICAL_CATEGORY.test(input.category)) return true
  if (DENTAL_BUYER.test(input.unitName)) return true
  return false
}

type RawRecord = {
  date: number
  unit_name: string
  unit_id: string
  job_number: string
  brief?: { title?: string; type?: string; category?: string }
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

/** 取某一天的全部公告（完整，不受標題關鍵字限制）。失敗時回錯誤訊息，不吞掉 */
async function listByDate(yyyymmdd: string): Promise<{ records: RawRecord[]; error?: string }> {
  try {
    const res = await fetch(`${API}/listbydate?date=${yyyymmdd}`, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return { records: [], error: `HTTP ${res.status}` }
    const json: any = await res.json()
    return { records: json?.records ?? [] }
  } catch (e: any) {
    return { records: [], error: e?.message ?? String(e) }
  }
}

async function searchKeyword(keyword: string, maxPages: number, sinceDate: string): Promise<RawRecord[]> {
  const out: RawRecord[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API}/searchbytitle?query=${encodeURIComponent(keyword)}&page=${page}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) break
    const json: any = await res.json()
    const records: RawRecord[] = json?.records ?? []
    if (records.length === 0) break
    out.push(...records)
    // 回傳是新到舊；整頁都早於起始日就不用再翻
    if (records.every((r) => toDate(r.date) < sinceDate)) break
    await sleep(300)
  }
  return out.filter((r) => toDate(r.date) >= sinceDate)
}

type DetailBundle = { detail: Record<string, string>; bidders: string[] } | null

async function fetchDetail(unitId: string, jobNumber: string): Promise<DetailBundle> {
  try {
    const res = await fetch(`${API}/tender?unit_id=${encodeURIComponent(unitId)}&job_number=${encodeURIComponent(jobNumber)}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const json: any = await res.json()
    // 同一案號可能有多則公告（招標→更正→決標），取最新一則的明細
    const recs: any[] = json?.records ?? []
    // 決標公告優先（有得標廠商與金額）；沒有就取最新一則
    const sorted = recs.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    const picked = sorted.find((r) => /^決標公告/.test(r?.brief?.type ?? '')) ?? sorted[0]
    if (!picked) return null
    return { detail: picked.detail ?? {}, bidders: picked?.brief?.companies?.names ?? [] }
  } catch {
    return null
  }
}

/**
 * 逐日全量掃描並過濾出牙科相關標案。
 * from/to 為 YYYY-MM-DD（含）；不給 from 就往前推 days 天。
 */
export async function fetchTendersByDateRange(options?: {
  from?: string
  to?: string
  days?: number
  withDetail?: boolean
  detailLimit?: number
}): Promise<{ records: TenderRecord[]; scannedDays: number; scannedRecords: number; failedDays: number; firstError: string }> {
  const to = options?.to ?? new Date().toISOString().slice(0, 10)
  const from = options?.from
    ?? new Date(Date.now() - (options?.days ?? 120) * 86400_000).toISOString().slice(0, 10)

  const byId = new Map<string, TenderRecord>()
  let scannedDays = 0, scannedRecords = 0, failedDays = 0, firstError = ''
  for (let d = new Date(from); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
    const { records: rows, error } = await listByDate(ymd)
    if (error) { failedDays++; if (!firstError) firstError = `${ymd}: ${error}` }
    scannedDays++; scannedRecords += rows.length
    for (const r of rows) {
      const title = r.brief?.title ?? ''
      const unitName = r.unit_name ?? ''
      const category = r.brief?.category ?? ''
      const hit = matchKeywords({ title, unitName, category })
      if (!hit) continue
      const id = `${r.unit_id}|${r.job_number}`
      const date = toDate(r.date)
      const existing = byId.get(id)
      if (existing) {
        for (const k of hit.matched) if (!existing.matched.includes(k)) existing.matched.push(k)
        if (date >= existing.date) { existing.date = date; existing.type = r.brief?.type ?? existing.type }
        continue
      }
      byId.set(id, {
        id, unitId: r.unit_id, jobNumber: r.job_number, unitName, title,
        type: r.brief?.type ?? '', date, category,
        matched: hit.matched, tier: hit.tier,
        budget: null, budgetText: '', deadline: '', address: '', city: '', district: '',
        contact: '', phone: '', url: '',
        winner: '', awardAmount: null, basePrice: null, bidders: [],
      })
    }
    await sleep(250)
  }

  const records = Array.from(byId.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
  if (options?.withDetail !== false) await enrichDetails(records, options?.detailLimit ?? 300)
  return { records, scannedDays, scannedRecords, failedDays, firstError }
}

/** 我們自己投過的標（依廠商名稱查）——得標與落標都算，供回填與戰況分析 */
export async function fetchOurBids(companyName = '崧達'): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${API}/searchbycompanyname?query=${encodeURIComponent(companyName)}&page=${page}`,
        { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) break
      const json: any = await res.json()
      const recs: any[] = json?.records ?? []
      if (recs.length === 0) break
      for (const r of recs) ids.add(`${r.unit_id}|${r.job_number}`)
      if (page >= (json?.total_pages ?? 1)) break
      await sleep(300)
    }
  } catch { /* 查不到就算了，不影響主流程 */ }
  return ids
}

/**
 * 抓取近 days 天、與牙科相關的標案（舊的關鍵字搜尋路徑，保留供比對用）。
 * withDetail=false 時只回公告層資料（快、供 dry-run 盤點用）。
 */
export async function fetchDentalTenders(options?: {
  days?: number
  maxPagesPerKeyword?: number
  withDetail?: boolean
  detailLimit?: number
}): Promise<{ records: TenderRecord[]; stats: Record<string, { fetched: number; kept: number }> }> {
  const days = options?.days ?? 120
  const maxPages = options?.maxPagesPerKeyword ?? 3
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const byId = new Map<string, TenderRecord>()
  const stats: Record<string, { fetched: number; kept: number }> = {}

  const handle = async (keyword: string, tier: 1 | 2) => {
    const raws = await searchKeyword(keyword, maxPages, since).catch(() => [])
    let kept = 0
    for (const r of raws) {
      const title = r.brief?.title ?? ''
      const unitName = r.unit_name ?? ''
      const category = r.brief?.category ?? ''
      if (tier === 2 && !isDentalContext({ title, unitName, category })) continue
      const id = `${r.unit_id}|${r.job_number}`
      const date = toDate(r.date)
      const existing = byId.get(id)
      if (existing) {
        if (!existing.matched.includes(keyword)) existing.matched.push(keyword)
        // 留最新一則公告的類型與日期
        if (date > existing.date) { existing.date = date; existing.type = r.brief?.type ?? existing.type }
        continue
      }
      byId.set(id, {
        id, unitId: r.unit_id, jobNumber: r.job_number, unitName, title,
        type: r.brief?.type ?? '', date, category,
        matched: [keyword], tier,
        budget: null, budgetText: '', deadline: '', address: '', city: '', district: '',
        contact: '', phone: '', url: '',
        winner: '', awardAmount: null, basePrice: null, bidders: [],
      })
      kept++
    }
    stats[keyword] = { fetched: raws.length, kept }
  }

  for (const k of TENDER_KEYWORDS_PRIMARY) await handle(k, 1)
  for (const k of TENDER_KEYWORDS_SECONDARY) await handle(k, 2)

  const records = Array.from(byId.values()).sort((a, b) => (a.date < b.date ? 1 : -1))

  if (options?.withDetail !== false) await enrichDetails(records, options?.detailLimit ?? 200)

  return { records, stats }
}

/** 補明細：預算、截止、地址聯絡人、決標結果 */
export async function enrichDetails(records: TenderRecord[], limit: number): Promise<void> {
  {
    for (const rec of records.slice(0, limit)) {
      const bundle = await fetchDetail(rec.unitId, rec.jobNumber)
      await sleep(250)
      if (!bundle) continue
      const d = bundle.detail
      // 決標資料：欄位名稱依公告型態不同，取第一個對得上的
      const pick = (re: RegExp) => {
        const hit = Object.entries(d).find(([k]) => re.test(k))
        return hit ? hit[1] : ''
      }
      rec.winner = pick(/決標品項:.*得標廠商1:得標廠商$/) || pick(/得標廠商$/)
      rec.awardAmount = parseMoney(pick(/決標品項:.*決標金額$/) || pick(/投標廠商:投標廠商1:決標金額$/))
      rec.basePrice = parseMoney(pick(/底價金額$/))
      rec.bidders = bundle.bidders
      // 明細取的是決標公告時，案件狀態就是已決標——清單的「招標中／已決標」要跟著對
      if (rec.winner && !/決標/.test(rec.type)) rec.type = '決標公告'
      rec.budgetText = d['採購資料:預算金額'] ?? d['已公告資料:預算金額'] ?? ''
      rec.budget = parseMoney(rec.budgetText)
      rec.deadline = (d['領投開標:截止投標'] ?? d['領投開標:截止投標時間'] ?? '').slice(0, 16)
      rec.address = d['機關資料:機關地址'] ?? ''
      const area = parseArea(rec.address)
      rec.city = area.city; rec.district = area.district
      rec.contact = d['機關資料:聯絡人'] ?? ''
      rec.phone = d['機關資料:聯絡電話'] ?? ''
      rec.url = d['url'] ?? ''
      if (!rec.category) rec.category = d['採購資料:標的分類'] ?? ''
    }
  }
}
