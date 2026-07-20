/**
 * lib/notion/opportunity.ts — 商機偵測(葉領域)
 *
 * 讀:客戶主檔「商機標籤」multi_select(由 Google Places+官網掃描寫入)。
 * 寫:掃描某區牙醫診所 → 反查官網 → 關鍵字偵測 → 把商機標籤「加」進主檔(只加不蓋),
 *     偵測到院內技工室順手勾「附屬技工室」(只設 true)。
 *
 * 費用:掃描會呼叫 Google Places(每家約 US$0.03),故掃描僅限管理層、dryRun 先預覽。
 * 安全:官網 fetch 走 SSRF 防護(https + 擋私網位址);Places 端點為固定主機。
 */
import { notion, DB, normalizeDatabaseId, notionCallWithRetry, getTitle, getText, getSelect, getProp } from './shared'
import { detectOpportunities } from '@/lib/opportunity-signals'
import { getOpportunityKeywordLibrary } from '@/lib/opportunity-keywords'

const CUST = () => normalizeDatabaseId(DB.customers!)

export type OppCustomer = {
  id: string; name: string; city: string; district: string
  salesperson: string; phone: string; address: string
  tags: string[]; goldTags: string[]
}

function mapOpp(page: any, goldTags: Set<string>): OppCustomer {
  const tags = (getProp(page, '商機標籤')?.multi_select ?? []).map((o: any) => o.name).filter(Boolean)
  return {
    id: page.id,
    name: getTitle(page, '客戶名稱'),
    city: getSelect(page, '縣市') || getText(page, '縣市'),
    district: getText(page, '行政區'),
    salesperson: getSelect(page, '負責業務'),
    phone: page.properties?.['電話']?.phone_number ?? getText(page, '電話'),
    address: getText(page, '地址'),
    tags,
    goldTags: tags.filter((t: string) => goldTags.has(t)),
  }
}

/** 列出有商機標籤的客戶(可依標籤/縣市/區/業務/僅金訊號 篩)。金訊號客戶排前。 */
export async function listOpportunityCustomers(f: {
  tag?: string; city?: string; district?: string; salesperson?: string; goldOnly?: boolean
} = {}): Promise<OppCustomer[]> {
  if (!DB.customers) return []
  const library = await getOpportunityKeywordLibrary()
  const goldTags = new Set(library.signals.filter((signal) => signal.gold).map((signal) => signal.tag))
  const clauses: any[] = [{ property: '商機標籤', multi_select: { is_not_empty: true } }]
  if (f.tag) clauses.push({ property: '商機標籤', multi_select: { contains: f.tag } })
  if (f.city) clauses.push({ property: '縣市', select: { equals: f.city } })
  if (f.district) clauses.push({ property: '行政區', rich_text: { equals: f.district } })
  if (f.salesperson) clauses.push({ property: '負責業務', select: { equals: f.salesperson } })

  const out: OppCustomer[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listOpportunityCustomers', () =>
      notion.databases.query({
        database_id: CUST(), page_size: 100,
        filter: clauses.length === 1 ? clauses[0] : { and: clauses },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) out.push(mapOpp(page, goldTags))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  let items = out
  if (f.goldOnly) items = items.filter((c) => c.goldTags.length > 0)
  // 金訊號多的排前,其次標籤多的,再依名稱
  items.sort((a, b) => b.goldTags.length - a.goldTags.length || b.tags.length - a.tags.length || a.name.localeCompare(b.name, 'zh-TW'))
  return items
}

/**
 * 有商機標籤、但還沒人認領、也還沒進開發漏斗(開發階段空白)的客戶——供漏斗頁「商機客戶」提示區使用。
 * 已在漏斗裡(開發階段非空)的商機客戶不重複列出,避免同一人在兩個提示區各出現一次。
 */
export async function listUnclaimedOpportunityLeads(): Promise<OppCustomer[]> {
  if (!DB.customers) return []
  const library = await getOpportunityKeywordLibrary()
  const goldTags = new Set(library.signals.filter((signal) => signal.gold).map((signal) => signal.tag))
  const items: OppCustomer[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listUnclaimedOpportunityLeads', () =>
      notion.databases.query({
        database_id: CUST(), page_size: 100,
        filter: { and: [
          { property: '商機標籤', multi_select: { is_not_empty: true } },
          { property: '負責業務', select: { is_empty: true } },
          { property: '開發階段', select: { is_empty: true } },
        ] },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) items.push(mapOpp(page, goldTags))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  items.sort((a, b) => b.goldTags.length - a.goldTags.length || a.name.localeCompare(b.name, 'zh-TW'))
  return items
}

/** 各商機標籤的客戶計數 + 金訊號家數(供分頁頂部統計)。 */
export async function getOpportunityStats(): Promise<{ tagCounts: Record<string, number>; goldCustomers: number; total: number; allTags: string[]; goldTags: string[] }> {
  const library = await getOpportunityKeywordLibrary()
  const allTags = library.signals.map((signal) => signal.tag)
  const goldTags = library.signals.filter((signal) => signal.gold).map((signal) => signal.tag)
  const all = await listOpportunityCustomers()
  const tagCounts: Record<string, number> = {}
  for (const t of allTags) tagCounts[t] = 0
  let goldCustomers = 0
  for (const c of all) {
    for (const t of c.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1
    if (c.goldTags.length) goldCustomers++
  }
  return { tagCounts, goldCustomers, total: all.length, allTags, goldTags }
}

// ── 掃描(Google Places + 官網)────────────────────────────────────────

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /^\[?fc[0-9a-f]{2}:/i, /^\[?fe80:/i,
]
// 官網 URL 來自 Google,可能是任意網址 → 只允許 https 且非私網位址(SSRF 防護)
function isSafePublicUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  return !PRIVATE_HOST_PATTERNS.some((re) => re.test(u.hostname))
}

const htmlToText = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

async function placeLookup(name: string, addr: string, key: string) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.editorialSummary' },
    body: JSON.stringify({ textQuery: `${name} ${addr}`, languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 1 }),
  })
  const j: any = await res.json()
  if (j.error) throw new Error(j.error.details?.find((d: any) => d.reason)?.reason || j.error.status || 'places error')
  return (j.places ?? [])[0] || null
}

async function fetchSite(url: string): Promise<string> {
  if (!isSafePublicUrl(url)) return ''
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SongtahBot/1.0)' }, signal: AbortSignal.timeout(10000) })
    return htmlToText(await r.text())
  } catch { return '' }
}

export type ScanResultRow = { id: string; name: string; tags: string[]; goldTags: string[]; evidence: string[] }
export type ScanResult = {
  dryRun: boolean; city: string; district: string
  total: number; placeHit: number; tagged: number; goldCustomers: number
  apiCalls: number; estUsd: number
  tagCounts: Record<string, number>
  rows: ScanResultRow[]   // 有命中的
  written: number
}

/**
 * 掃描某區牙醫診所並(可選)寫回商機標籤。
 * dryRun=true:只回預覽(命中標籤+證據),不寫;dryRun=false:寫回主檔(標籤只加不蓋)。
 * 大區(數百家)耗時長,呼叫端須設足夠 maxDuration。
 */
export async function scanDistrict(city: string, district: string, opts: { dryRun?: boolean } = {}): Promise<ScanResult> {
  const dryRun = opts.dryRun !== false
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('未設定 GOOGLE_PLACES_API_KEY')
  if (!DB.customers) throw new Error('客戶主檔未設定')
  const library = await getOpportunityKeywordLibrary()
  const dictionary = library.signals
  const goldTagSet = new Set(dictionary.filter((signal) => signal.gold).map((signal) => signal.tag))

  // 撈該區牙醫診所
  const custs: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('scanDistrict:list', () =>
      notion.databases.query({
        database_id: CUST(), page_size: 100,
        filter: { and: [
          { property: '縣市', select: { equals: city } },
          { property: '行政區', rich_text: { equals: district } },
          { property: '客戶類型', select: { equals: '牙醫診所' } },
        ] },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    custs.push(...(res.results ?? []))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  const tagCounts: Record<string, number> = {}
  const rows: ScanResultRow[] = []
  let placeHit = 0, tagged = 0, goldCustomers = 0, apiCalls = 0, written = 0

  for (const p of custs) {
    const name = getTitle(p, '客戶名稱')
    const addr = getText(p, '地址')
    let place: any = null
    try { place = await placeLookup(name, addr, key); apiCalls++ } catch { apiCalls++; continue }
    if (!place) continue
    placeHit++
    let corpus = (place.displayName?.text || '') + ' ' + (place.editorialSummary?.text || '')
    if (place.websiteUri) { const t = await fetchSite(place.websiteUri); if (t) corpus += ' ' + t }
    const hits = detectOpportunities(corpus, dictionary)
    if (hits.length === 0) continue
    tagged++
    const tags = hits.map((h) => h.tag)
    const goldTags = tags.filter((t) => goldTagSet.has(t))
    if (goldTags.length) goldCustomers++
    for (const t of tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1
    rows.push({ id: p.id, name, tags, goldTags, evidence: hits.map((h) => h.evidence).filter(Boolean).slice(0, 3) })

    if (!dryRun) {
      const existing = (getProp(p, '商機標籤')?.multi_select ?? []).map((o: any) => o.name)
      const merged = Array.from(new Set([...existing, ...tags]))
      const props: any = { '商機標籤': { multi_select: merged.map((n) => ({ name: n })) } }
      if (goldTags.includes('院內技工室') && getProp(p, '附屬技工室')?.checkbox !== true) props['附屬技工室'] = { checkbox: true }
      await notionCallWithRetry('scanDistrict:write', () => notion.pages.update({ page_id: p.id, properties: props }))
      written++
    }
  }

  rows.sort((a, b) => b.goldTags.length - a.goldTags.length || b.tags.length - a.tags.length)
  return {
    dryRun, city, district, total: custs.length, placeHit, tagged, goldCustomers,
    apiCalls, estUsd: +(apiCalls * 0.032).toFixed(2), tagCounts, rows, written,
  }
}
