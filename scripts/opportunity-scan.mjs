/**
 * 商機偵測 pilot 掃描器:給一批診所官網 URL,抓文字、跑關鍵字字典、印出命中與證據句。
 * 字典來源 = data/opportunity-keywords.json(與 lib/opportunity-signals.ts 同一份)。
 *
 * 用法: node scripts/opportunity-scan.mjs <url1> <url2> ...
 * 注意:正式功能的伺服器端 route 必須套 SSRF 防護(host allowlist + 私網位址檢查),
 *      本 pilot 由人工在本機跑,僅做 https 基本檢查。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dict = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'opportunity-keywords.json'), 'utf8'))
const SIGNALS = dict.signals ?? []

const normalize = (s) => (s || '')
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/\s+/g, '').toLowerCase()

function extractEvidence(rawText, keyword) {
  const sentences = rawText.split(/[。！？\n\r;；]+/).map((x) => x.trim()).filter(Boolean)
  const nk = normalize(keyword)
  for (const sen of sentences) if (normalize(sen).includes(nk)) return sen.length > 80 ? sen.slice(0, 80) + '…' : sen
  const idx = normalize(rawText).indexOf(nk)
  if (idx < 0) return ''
  return '…' + rawText.slice(Math.max(0, idx - 40), idx + keyword.length + 40).replace(/\s+/g, ' ').trim() + '…'
}

function detect(text) {
  const nText = normalize(text)
  const hits = []
  for (const sig of SIGNALS) {
    const matched = sig.keywords.find((kw) => nText.includes(normalize(kw)))
    if (matched) hits.push({ tag: sig.tag, keyword: matched, evidence: extractEvidence(text, matched), productLines: sig.productLines })
  }
  return hits
}

// 極簡 HTML→文字(去 script/style/標籤、解常見實體)
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
}

async function scan(url) {
  if (!url.startsWith('https://')) { console.log(`\n⚠ 略過非 https:${url}`); return }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SongtahBot/1.0)' }, signal: AbortSignal.timeout(15000) })
    const html = await res.text()
    const text = htmlToText(html)
    const hits = detect(text)
    console.log(`\n■ ${url}  (HTTP ${res.status}, 文字 ${text.length} 字)`)
    if (hits.length === 0) { console.log('  (無命中)'); return }
    for (const h of hits) {
      console.log(`  ✔ [${h.tag}] 命中「${h.keyword}」→ 產品線:${h.productLines.join('、')}`)
      console.log(`     證據:${h.evidence}`)
    }
  } catch (e) {
    console.log(`\n✗ ${url}  抓取失敗:${e.message}`)
  }
}

const urls = process.argv.slice(2)
if (urls.length === 0) { console.log('用法: node scripts/opportunity-scan.mjs <url> ...'); process.exit(1) }
for (const u of urls) await scan(u)
