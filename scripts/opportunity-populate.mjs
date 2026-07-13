/**
 * 商機標籤寫回主檔:撈某區牙醫診所 → Google Places 反查官網/商家名/簡介 → 掃描 →
 * 把偵測到的商機標籤「加」進客戶主檔「商機標籤」multi_select(保留既有值,不蓋);
 * 偵測到「院內技工室」時順手把「附屬技工室」checkbox 設 true(只設 true,永不清成 false)。
 *
 * 用法:
 *   node --env-file=.env.local scripts/opportunity-populate.mjs 臺北市 大安區          # dry-run(預設,不寫)
 *   node --env-file=.env.local scripts/opportunity-populate.mjs 臺北市 大安區 --execute # 真寫
 *
 * 安全:只讀客戶名稱/地址;寫入為「加標籤」(先讀既有 multi_select 再合併),不刪不蓋既有標籤。
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

const args = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const positional = args.filter((a) => !a.startsWith('--'))
const [city = '臺北市', district = '大安區'] = positional
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const normalize = (s) => (s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, '').toLowerCase()
function detect(text) {
  const n = normalize(text); const tags = []
  for (const sig of SIGNALS) if (sig.keywords.find((k) => n.includes(normalize(k)))) tags.push(sig.tag)
  return tags
}
const htmlToText = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

async function placeLookup(name, addr) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.editorialSummary' },
    body: JSON.stringify({ textQuery: `${name} ${addr}`, languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 1 }),
  })
  const j = await res.json()
  if (j.error) return { error: j.error.details?.find((d) => d.reason)?.reason || j.error.status }
  return { place: (j.places ?? [])[0] || null }
}
async function fetchSite(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SongtahBot/1.0)' }, signal: AbortSignal.timeout(12000) }); return htmlToText(await r.text()) } catch { return '' }
}

;(async () => {
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

  console.log(`\n== ${city}${district} 牙醫診所 商機標籤${EXECUTE ? '【真寫】' : '【DRY-RUN 不寫】'} ==`)
  console.log(`共 ${custs.length} 家\n`)

  let placeHit = 0, tagged = 0, apiCalls = 0, written = 0, techRoom = 0
  const tagCount = {}
  for (const p of custs) {
    const name = p.properties['客戶名稱']?.title?.map((t) => t.plain_text).join('') || ''
    const addr = (p.properties['地址']?.rich_text ?? []).map((t) => t.plain_text).join('')
    const { place, error } = await placeLookup(name, addr); apiCalls++
    if (error) { console.log(`✗ ${name}:API ${error}`); await sleep(150); continue }
    if (!place) { await sleep(150); continue }
    placeHit++
    let corpus = (place.displayName?.text || '') + ' ' + (place.editorialSummary?.text || '')
    if (place.websiteUri) { const t = await fetchSite(place.websiteUri); if (t) corpus += ' ' + t }
    const tags = detect(corpus)
    if (tags.length === 0) { await sleep(150); continue }
    tagged++
    for (const t of tags) tagCount[t] = (tagCount[t] || 0) + 1
    const hasTechRoom = tags.includes('院內技工室')
    if (hasTechRoom) techRoom++
    const gold = tags.filter((t) => ['院內技工室', '數位牙科', '3D列印'].includes(t))
    console.log(`${gold.length ? '🔥' : '✔'} ${name} → ${tags.join('、')}${gold.length ? `  [金:${gold.join('/')}]` : ''}`)

    if (EXECUTE) {
      // 讀既有商機標籤,合併(不蓋);附屬技工室只設 true 不清 false
      const existing = (p.properties['商機標籤']?.multi_select ?? []).map((o) => o.name)
      const merged = Array.from(new Set([...existing, ...tags]))
      const props = { '商機標籤': { multi_select: merged.map((name) => ({ name })) } }
      if (hasTechRoom && p.properties['附屬技工室']?.checkbox !== true) props['附屬技工室'] = { checkbox: true }
      await notion.pages.update({ page_id: p.id, properties: props })
      written++
    }
    await sleep(150)
  }

  console.log(`\n── 統計 ──`)
  console.log(`Google 命中:${placeHit}/${custs.length};有商機訊號:${tagged} 家;🔥 院內技工室:${techRoom} 家`)
  console.log(`標籤分布:${Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' / ')}`)
  console.log(`Google API 呼叫:${apiCalls} 次,約 US$${(apiCalls * 0.032).toFixed(2)}`)
  if (EXECUTE) console.log(`✅ 已寫入 ${written} 家的商機標籤`)
  else console.log(`(DRY-RUN,未寫入。加 --execute 真寫)`)
})()
