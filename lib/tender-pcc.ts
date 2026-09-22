/**
 * lib/tender-pcc.ts — 直接從政府電子採購網官網抓標案（取代第三方 API）
 *
 * 為什麼換來源：原本走 g0v/openfun 的鏡像 API，但它對**資料中心 IP 一律回 403**
 * ——Vercel 與 GitHub Action runner 都被擋，只有本機（家用 IP）能抓，等於正式站永遠沒新資料。
 * 實測官網 web.pcc.gov.tw 在 runner 端可正常存取，因此改成直接打官網的公告查詢。
 *
 * 做法（跟逐日全量掃描相反，改成關鍵字查詢）：
 *   1. 官網「公告查詢」表單 readBulletion 支援 querySentence（標案名稱關鍵字）
 *      ＋ tenderStatusType（招標／決標）＋ timeRange（民國年），依公告日新到舊排序。
 *   2. 對每個牙科關鍵字各查一次（招標＋決標），只留日期落在區間內的。
 *   3. 命中案子再抓明細頁補機關代碼、地址（縣市／行政區，客戶比對必需）、預算、決標結果。
 * 成本：關鍵字數 × 2 個請求，遠低於逐日全量；命中量小（每週個位數到十幾案），明細成本可忽略。
 *
 * 限制一：查詢只取第一頁（100 筆／關鍵字／年，依公告日新到舊）。日常增量遠不會滿，
 * 但整年回補若某關鍵字超過 100 筆會截斷——歷史回補請搭配官方開放資料檔。
 * 限制二：**明細頁有機器人驗證**，短時間抓十幾次就會跳撲克牌驗證碼並鎖住該 IP 數十分鐘
 * （GitHub runner 的共用 IP 常常一抓就被擋）。因此明細只當加值：清單本身就足以成案，
 * 抓不到明細的案子照樣寫入（機關代碼、地址、預算留空），之後由 enrich 流程慢慢補。
 */
import {
  TENDER_KEYWORDS_PRIMARY, TENDER_KEYWORDS_SECONDARY,
  matchKeywords, type TenderRecord,
} from './tender-source'

const BASE = 'https://web.pcc.gov.tw'
const SEARCH = `${BASE}/prkms/tender/common/bulletion/readBulletion`

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-TW,zh;q=0.9',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 民國日期 115/09/22 → 2026-09-22 */
function rocToISO(s: string): string {
  const m = (s ?? '').match(/(\d{2,3})\/(\d{2})\/(\d{2})/)
  if (!m) return ''
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&emsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const parseMoney = (text: string): number | null => {
  const m = (text ?? '').replace(/,/g, '').match(/(\d+)\s*元/)
  return m ? Number(m[1]) : null
}

function parseArea(addr: string): { city: string; district: string } {
  const city = addr.match(/(台北市|臺北市|新北市|基隆市|桃園市|新竹市|新竹縣|苗栗縣|台中市|臺中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/)?.[1] ?? ''
  const district = addr.match(/[市縣]\s*([一-龥]{1,3}[區鄉鎮市])/)?.[1] ?? ''
  return { city: city.replace(/台/, '臺'), district }
}

type PccHit = {
  key: string          // 明細頁路徑＋pk，用來抓明細
  path: string         // tpam（招標）／atm（決標）／nonAtm（無法決標）
  pk: string
  kind: '招標' | '決標'
  type: string         // 公告類型文字
  unitName: string
  jobNumber: string
  title: string
  date: string         // 這則公告的日期（招標＝公告日、決標＝決標公告日）
  deadline: string     // 截止投標日（清單上就有）
}

/**
 * 查一個關鍵字。官網會把標案名稱畫成圖片防爬，但 JS 參數裡仍有原文
 * （`pageCode2Img("標案名稱")`），檢視連結的 title 屬性也有，兩者互為備援。
 */
async function searchKeyword(keyword: string, kind: '招標' | '決標', rocYear: number): Promise<PccHit[]> {
  const body = new URLSearchParams({
    querySentence: keyword,
    tenderStatusType: kind,
    sortCol: kind === '招標' ? 'TENDER_NOTICE_DATE' : 'AWARD_NOTICE_DATE',
    timeRange: String(rocYear),
    pageSize: '100',
  })
  const res = await fetch(SEARCH, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/prkms/tender/common/bulletion/indexBulletion` },
    body,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  const hits: PccHit[] = []
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const link = row.match(/\/prkms\/urlSelector\/common\/(tpam|atm|nonAtm)\?pk=([^"&]+)/)
    if (!link) continue
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(strip)
    const title = row.match(/pageCode2Img\("([^"]+)"\)/)?.[1]
      ?? row.match(/title="檢視\s*標案(?:名稱|案號):\s*([^"]+)"/)?.[1] ?? ''
    // 公告查詢的結果表格招標／決標共用同一組欄位：
    // 項次 | 種類 | 機關名稱 | 案號＋標案名稱 | 招標公告日期 | 決標或無法決標公告 | 截止投標 | 公開閱覽 | 預告
    const jobNumber = (cells[3] ?? '').replace(title, '').replace(/\(更正公告\)/, '').trim()
    const date = rocToISO(kind === '招標' ? (cells[4] ?? '') : (cells[5] ?? ''))
    hits.push({
      key: `${link[1]}|${link[2]}`, path: link[1], pk: link[2], kind,
      type: cells[1] || (kind === '招標' ? '招標公告' : '決標公告'),
      unitName: cells[2] ?? '', jobNumber, title, date,
      deadline: rocToISO(cells[6] ?? ''),
    })
  }
  return hits
}

/**
 * 明細頁：整頁是「標籤｜值」的表格，抓成多重對應（同一標籤可能重複，例如多家投標廠商）。
 * 回 null 代表被官網的機器人驗證擋下（明細頁短時間連抓十幾次就會跳撲克牌驗證碼，
 * 且會鎖住該 IP 一段時間）——遇到就整批停手，不要硬打。
 */
export async function fetchDetail(path: string, pk: string): Promise<Map<string, string[]> | null> {
  const res = await fetch(`${BASE}/prkms/urlSelector/common/${path}?pk=${pk}`, {
    headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(60_000),
  })
  const map = new Map<string, string[]>()
  if (!res.ok) return map
  const html = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '')
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(strip).filter(Boolean)
    if (cells.length < 2) continue
    const list = map.get(cells[0]) ?? []
    list.push(cells[1])
    map.set(cells[0], list)
  }
  if (!map.has('機關代碼') && /驗證碼/.test(html)) return null
  return map
}

const one = (m: Map<string, string[]>, key: string) => m.get(key)?.[0] ?? ''

/**
 * 抓區間內的牙科相關標案（含決標）。
 * from／to 為 YYYY-MM-DD；回傳已去重、已補明細的 TenderRecord。
 */
export async function fetchDentalTendersFromPcc(options: {
  from: string
  to?: string
  detailLimit?: number
}): Promise<{ records: TenderRecord[]; candidates: number; enriched: number; detailBlocked: boolean; queries: number; failedQueries: number; firstError: string }> {
  const to = options.to ?? new Date().toISOString().slice(0, 10)
  const from = options.from
  const years: number[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y - 1911)

  const keywords = [...TENDER_KEYWORDS_PRIMARY, ...TENDER_KEYWORDS_SECONDARY]
  const byKey = new Map<string, PccHit>()
  let queries = 0, failedQueries = 0, firstError = ''

  for (const keyword of keywords) {
    for (const year of years) {
      for (const kind of ['招標', '決標'] as const) {
        queries++
        try {
          for (const hit of await searchKeyword(keyword, kind, year)) {
            if (!hit.date || hit.date < from || hit.date > to) continue
            // 同一案的招標與決標是兩則公告，分開保留（決標會在寫入時覆蓋同一列）
            const prev = byKey.get(hit.key)
            if (!prev || hit.date > prev.date) byKey.set(hit.key, hit)
          }
        } catch (e: any) {
          failedQueries++
          if (!firstError) firstError = `${keyword}/${kind}: ${e?.message ?? e}`
        }
        await sleep(300)
      }
    }
  }

  // 關鍵字命中標案名稱只是初篩，仍要過共用的命中判定（排除齒輪／獸醫等，第二級需牙科情境）
  const candidates = Array.from(byKey.values()).sort((a, b) => (a.date < b.date ? 1 : -1))
  const records: TenderRecord[] = []
  const limit = options.detailLimit ?? 3
  let detailBlocked = false
  let enriched = 0

  for (const hit of candidates) {
    const hitKw = matchKeywords({ title: hit.title, unitName: hit.unitName })
    if (!hitKw) continue

    // 明細是加值不是門檻：抓不到就留空欄位照樣寫入，之後再補
    let detail: Map<string, string[]> | null = new Map()
    if (!detailBlocked && enriched < limit) {
      detail = await fetchDetail(hit.path, hit.pk).catch(() => new Map<string, string[]>())
      if (detail === null) { detailBlocked = true; detail = new Map() } else { enriched++; await sleep(4_000) }
    }

    const category = one(detail, '標的分類')
    // 帶上標的分類再判一次：第二級關鍵字（3D 列印、樹脂…）靠醫療分類才成立
    const hit2 = matchKeywords({ title: hit.title, unitName: hit.unitName, category }) ?? hitKw
    const address = one(detail, '機關地址')
    // 沒有明細地址時退而求其次用機關名稱推縣市（衛生所、縣市政府、某某縣醫院多半看得出來）
    const area = address ? parseArea(address) : parseArea(hit.unitName)
    const unitId = one(detail, '機關代碼')
    const vendors = detail.get('廠商名稱') ?? []
    const winner = one(detail, '得標廠商') || (one(detail, '是否得標') === '是' ? (vendors[0] ?? '') : '')

    records.push({
      // 沒有機關代碼時用機關名稱當鍵；寫入端同時以「機關名稱＋案號」比對既有列，
      // 之後補到機關代碼也會更新到同一列，不會變成兩筆
      id: unitId ? `${unitId}|${hit.jobNumber}` : `pcc|${hit.unitName}|${hit.jobNumber}`,
      unitId, jobNumber: hit.jobNumber, unitName: hit.unitName, title: hit.title,
      type: hit.type, date: hit.date, category,
      matched: hit2.matched, tier: hit2.tier,
      budget: parseMoney(one(detail, '預算金額')),
      budgetText: one(detail, '預算金額'),
      deadline: rocToISO(one(detail, '截止投標')) || hit.deadline,
      address, city: area.city, district: area.district,
      contact: one(detail, '聯絡人'),
      phone: one(detail, '聯絡電話'),
      url: `${BASE}/prkms/urlSelector/common/${hit.path}?pk=${hit.pk}`,
      winner,
      awardAmount: parseMoney(one(detail, '總決標金額') || one(detail, '決標金額')),
      basePrice: parseMoney(one(detail, '底價金額')),
      bidders: vendors,
    })
  }

  return { records, candidates: candidates.length, enriched, detailBlocked, queries, failedQueries, firstError }
}

/**
 * 補明細：拿「尚未補到機關代碼」的既有列，重抓一次明細頁組成完整紀錄。
 * 明細頁隨時可能被機器人驗證擋下，擋下就整批停手（回傳 blocked），下一輪再試。
 */
export async function enrichPendingTenders(
  pending: { url: string; unitName: string; jobNumber: string; title: string; type: string; date: string; deadline: string }[],
): Promise<{ records: TenderRecord[]; blocked: boolean }> {
  const records: TenderRecord[] = []
  for (const row of pending) {
    const m = row.url.match(/\/common\/(tpam|atm|nonAtm)\?pk=([^&]+)/)
    if (!m) continue
    const detail = await fetchDetail(m[1], decodeURIComponent(m[2])).catch(() => new Map<string, string[]>())
    if (detail === null) return { records, blocked: true }
    const unitId = one(detail, '機關代碼')
    if (!unitId) { await sleep(4_000); continue }

    const category = one(detail, '標的分類')
    const hit = matchKeywords({ title: row.title, unitName: row.unitName, category })
    const address = one(detail, '機關地址')
    const area = address ? parseArea(address) : parseArea(row.unitName)
    const vendors = detail.get('廠商名稱') ?? []
    const winner = one(detail, '得標廠商') || (one(detail, '是否得標') === '是' ? (vendors[0] ?? '') : '')
    records.push({
      id: `${unitId}|${row.jobNumber}`,
      unitId, jobNumber: row.jobNumber, unitName: row.unitName, title: row.title,
      type: row.type, date: row.date, category,
      matched: hit?.matched ?? [], tier: hit?.tier ?? 1,
      budget: parseMoney(one(detail, '預算金額')),
      budgetText: one(detail, '預算金額'),
      deadline: rocToISO(one(detail, '截止投標')) || row.deadline,
      address, city: area.city, district: area.district,
      contact: one(detail, '聯絡人'), phone: one(detail, '聯絡電話'), url: row.url,
      winner,
      awardAmount: parseMoney(one(detail, '總決標金額') || one(detail, '決標金額')),
      basePrice: parseMoney(one(detail, '底價金額')),
      bidders: vendors,
    })
    await sleep(4_000)
  }
  return { records, blocked: false }
}
