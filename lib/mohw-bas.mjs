/**
 * lib/mohw-bas.mjs
 *
 * 衛福部醫事機構查詢（BAS）共用模組（純 ESM JS，供 node 腳本與 Next API 共用）。
 * 來源：https://ma.mohw.gov.tw/Accessibility/BASSearch/MASearchBAS
 *
 * 提供：
 *   getSearchSession()                     取首頁 → { cookies, csrf, vcode }
 *   searchBas({ kind, name, session })     POST 搜尋 → 列表 [{ name, city, dist, basSeq, zoneSeq }]
 *   fetchBasDetail({ basSeq, zoneSeq, cookies })  詳細頁 → { code, status, name, address }
 *   lookupInstitution({ name, kind })      單筆查詢 → { found, code, status, name, address, candidates }
 *
 * BAS_KIND：1=醫院/診所、2=牙體技術所 …（牙體技術所固定用 '2'）。
 * CAPTCHA 答案直接放在首頁 img[data-code]，可直接讀取。
 */

const SEARCH  = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/MASearchBAS'
const RESULTS = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BasResults'
const DETAIL  = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData'

const BROWSER_HEADERS = {
  'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':  'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding':  'gzip, deflate, br',
  'Connection':       'keep-alive',
  'sec-ch-ua':        '"Google Chrome";v="125", "Chromium";v="125"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** HTML entity decode（BAS 回傳的中文常是 &#x...;（hex）或 &#...;（decimal）） */
export function decodeEntities(str) {
  return str
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/** 取首頁 → CSRF token、CAPTCHA 答案、session cookie */
export async function getSearchSession() {
  const res = await fetch(SEARCH, {
    headers: { ...BROWSER_HEADERS, 'Upgrade-Insecure-Requests': '1' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`MOHW 首頁 → HTTP ${res.status}`)
  const html = await res.text()
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const csrf = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) ??
                html.match(/value="(CfDJ[^"]+)"/))?.[1]
  const vcode = html.match(/data-code="([^"]+)"/)?.[1]
  if (!csrf || !vcode) throw new Error('無法取得 CSRF token 或 CAPTCHA code（WAF 或頁面改版）')
  return { cookies, csrf, vcode }
}

/** POST 搜尋 → 回傳列表（每筆含 basSeq/zoneSeq，供詳細頁查詢） */
export async function searchBas({ kind = '2', name = '', session }) {
  const { cookies, csrf, vcode } = session
  const body = new URLSearchParams({
    __RequestVerificationToken: csrf,
    BAS_KIND:       kind,
    ZONE_AREA_CODE: '全部',
    ZONE_ZIP_CODE:  '全部',
    DEP_DEPT_ID:    '全部',
    BAS_NAME:       name,
    txtVCode:       vcode,
  })
  const res = await fetch(RESULTS, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Cookie':         cookies,
      'Referer':        SEARCH,
      'Origin':         'https://ma.mohw.gov.tw',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'Cache-Control':  'max-age=0',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`MOHW 搜尋結果 → HTTP ${res.status}`)
  const html = await res.text()

  const rows = []
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1]
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    )
    if (cells.length < 4) continue
    const nm = cells[1]?.trim()
    if (!nm || nm === '機構名稱') continue
    const basSeq = row.match(/BAS_SEQ=([^&"]+)/)?.[1]
    if (!basSeq) continue
    rows.push({
      name: nm,
      city: cells[2]?.trim() ?? '',
      dist: cells[3]?.trim() ?? '',
      basSeq,
      zoneSeq: row.match(/ZONE_SEQ=([^&"]+)/)?.[1] ?? '',
    })
  }
  return rows
}

/** 詳細頁 → 機構代碼 + 開業狀態（開業／停業／歇業）+ 名稱 */
export async function fetchBasDetail({ basSeq, zoneSeq, cookies }) {
  const url = `${DETAIL}?BAS_SEQ=${basSeq}&ZONE_SEQ=${zoneSeq}`
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, 'Cookie': cookies, 'Referer': RESULTS },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) return null
  const html = decodeEntities(await res.text())
  const code   = html.match(/機構代碼[\s\S]{0,400}?<span[^>]*>\s*([A-Za-z0-9]{5,20})\s*<\/span>/)?.[1] ?? null
  const status = html.match(/開業狀態[\s\S]{0,200}?<span[^>]*>\s*([^<]{1,20}?)\s*<\/span>/)?.[1]?.trim() ?? ''
  const name   = html.match(/機構名稱[\s\S]{0,200}?<span[^>]*>\s*([^<]{1,40}?)\s*<\/span>/)?.[1]?.trim() ?? ''
  return { code, status, name }
}

/** 開業狀態是否代表停業/歇業 */
export function isClosedStatus(status) {
  return /停業|歇業|撤銷|註銷|廢止/.test(status ?? '')
}

/**
 * 單筆查詢：依名稱（可選 kind）查衛福部，回最相符的一筆機構代碼與開業狀態。
 * 回傳 { found, code, status, name, address, candidates }。
 * candidates：名稱相符的多個候選（供前端人工確認）。
 */
export async function lookupInstitution({ name, kind = '2' }) {
  if (!name || !name.trim()) return { found: false, code: null, status: '', name: '', candidates: [] }
  const session = await getSearchSession()
  const rows = await searchBas({ kind, name: name.trim(), session })

  if (rows.length === 0) {
    return { found: false, code: null, status: '', name: '', address: '', candidates: [] }
  }

  // 取第一筆抓詳細頁（搜尋已用名稱過濾）；其餘列為候選供人工判斷
  const top = rows[0]
  const detail = await fetchBasDetail({ basSeq: top.basSeq, zoneSeq: top.zoneSeq, cookies: session.cookies })
  return {
    found: true,
    code:    detail?.code ?? null,
    status:  detail?.status ?? '',
    name:    detail?.name || top.name,
    address: `${top.city}${top.dist}`,
    candidates: rows.slice(0, 10).map((r) => ({ name: r.name, address: `${r.city}${r.dist}` })),
  }
}

export { sleep, BROWSER_HEADERS }
