/**
 * 商機偵測 pilot:撈某區的牙醫診所 → Google Places 反查官網/商家名/簡介 → 掃描關鍵字 → 統計。
 * 用法: node --env-file=.env.local scripts/opportunity-pilot.mjs [縣市] [行政區] [上限]
 *   例: node --env-file=.env.local scripts/opportunity-pilot.mjs 臺北市 大安區 30
 * 只讀不寫(不動 Notion 主檔);驗證「命中率 + 官網覆蓋 + 訊號產出 + 費用」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Client } from '@notionhq/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dict = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'opportunity-keywords.json'), 'utf8'))
const SIGNALS = dict.signals ?? []
const KEY = process.env.GOOGLE_PLACES_API_KEY
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const CUST_DB = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? '').replace(/-/g, '')

const [city = '臺北市', district = '大安區', limitArg = '30'] = process.argv.slice(2)
const LIMIT = parseInt(limitArg, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const normalize = (s) => (s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, '').toLowerCase()
function detect(text) {
  const n = normalize(text); const hits = []
  for (const sig of SIGNALS) { const kw = sig.keywords.find((k) => n.includes(normalize(k))); if (kw) hits.push({ tag: sig.tag, kw }) }
  return hits
}
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Google Places Text Search(新版):名稱+地址 → 最佳匹配
async function placeLookup(name, addr) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.editorialSummary,places.businessStatus' },
    body: JSON.stringify({ textQuery: `${name} ${addr}`, languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 1 }),
  })
  const j = await res.json()
  if (j.error) return { error: j.error.details?.find((d) => d.reason)?.reason || j.error.status }
  return { place: (j.places ?? [])[0] || null }
}

async function fetchSite(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SongtahBot/1.0)' }, signal: AbortSignal.timeout(12000) })
    return htmlToText(await res.text())
  } catch { return '' }
}

;(async () => {
  // 撈該區牙醫診所(過濾查詢,不全掃)
  const custs = []
  let cur
  do {
    const r = await notion.databases.query({ database_id: CUST_DB, page_size: 100,
      filter: { and: [
        { property: '縣市', select: { equals: city } },
        { property: '行政區', rich_text: { equals: district } },
        { property: '客戶類型', select: { equals: '牙醫診所' } },
      ] }, ...(cur ? { start_cursor: cur } : {}) })
    custs.push(...r.results); cur = r.has_more ? r.next_cursor : undefined
  } while (cur)

  const sample = custs.slice(0, LIMIT)
  console.log(`\n== ${city}${district} 牙醫診所 pilot ==`)
  console.log(`該區共 ${custs.length} 家,取樣 ${sample.length} 家\n`)

  let placeHit = 0, siteHit = 0, signalHit = 0, apiCalls = 0
  const tagCount = {}
  const techRoom = [] // 院內技工室命中(最有價值)

  for (const p of sample) {
    const name = p.properties['客戶名稱']?.title?.map((t) => t.plain_text).join('') || ''
    const addr = (p.properties['地址']?.rich_text ?? []).map((t) => t.plain_text).join('')
    const { place, error } = await placeLookup(name, addr); apiCalls++
    if (error) { console.log(`✗ ${name}:API ${error}`); await sleep(200); continue }
    if (!place) { console.log(`– ${name}:Google 查無`); await sleep(200); continue }
    placeHit++
    const gName = place.displayName?.text || ''
    const web = place.websiteUri || ''
    const summary = place.editorialSummary?.text || ''
    // 訊號來源:商家名 + Google 簡介 + 官網文字
    let corpus = gName + ' ' + summary
    if (web) { const t = await fetchSite(web); if (t) { siteHit++; corpus += ' ' + t } }
    const hits = detect(corpus)
    if (hits.length) {
      signalHit++
      for (const h of hits) tagCount[h.tag] = (tagCount[h.tag] || 0) + 1
      const tags = hits.map((h) => h.tag)
      if (tags.includes('院內技工室')) techRoom.push(name)
      console.log(`✔ ${name}${web ? '' : '(無官網,靠商家名/簡介)'} → ${tags.join('、')}`)
    } else {
      console.log(`○ ${name}:Google 有 place${web ? '+官網' : ''},但無關鍵字命中`)
    }
    await sleep(200)
  }

  console.log(`\n── 統計 ──`)
  console.log(`Google 命中(名稱+地址→place):${placeHit}/${sample.length}`)
  console.log(`有官網:${siteHit}/${placeHit}`)
  console.log(`有商機訊號:${signalHit}/${sample.length}`)
  console.log(`標籤分布:${Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' / ') || '(無)'}`)
  console.log(`🔥 院內技工室(設備直客):${techRoom.length} 家 → ${techRoom.join('、') || '(無)'}`)
  // 費用:Text Search (New) 含 websiteUri 屬 Pro tier,約 US$0.032/次(每月前 $200 免費額度)
  const usd = (apiCalls * 0.032).toFixed(2)
  console.log(`\nGoogle API 呼叫:${apiCalls} 次,約 US$${usd}(每月 $200 免費額度內)`)
  console.log(`→ 推估全台 1 萬家掃一輪約 US$${(10000 * 0.032).toFixed(0)}(可只掃開業中+分月分批壓低)`)
})()
