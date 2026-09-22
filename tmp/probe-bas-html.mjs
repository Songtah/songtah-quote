import fs from 'fs'
const { getSearchSession, BROWSER_HEADERS } = await import('../lib/mohw-bas.mjs')
const cache = JSON.parse(fs.readFileSync('data/bas-cache.json','utf8'))
const keys = Object.keys(cache).slice(0, 1)
const session = await getSearchSession()
for (const k of keys) {
  const [basSeq, zoneSeq] = k.split('__')
  const url = `https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData?BAS_SEQ=${basSeq}&ZONE_SEQ=${zoneSeq}`
  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Cookie: session.cookieStr, Referer: 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BasResults' } })
  const html = await res.text()
  const i = html.indexOf('開業狀態')
  console.log('====', cache[k].name, '｜快取狀態', cache[k].status, '｜HTTP', res.status, '｜頁面長度', html.length)
  if (i < 0) console.log('  原始回應：', JSON.stringify(html.slice(0, 300).replace(/\s+/g, ' ')))
  else console.log(JSON.stringify(html.slice(i - 80, i + 260).replace(/\s+/g, ' ')))
  await new Promise(r => setTimeout(r, 800))
}
