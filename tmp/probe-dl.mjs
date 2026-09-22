const url = 'https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=tender_20260702.xml'
for (const [label, init] of [
  ['plain', {}],
  ['with-headers', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36', 'Referer': 'https://web.pcc.gov.tw/tps/tp/OpenData/showList', 'Accept': '*/*' } }],
]) {
  try {
    const r = await fetch(url, init)
    const t = await r.text()
    console.log(label, r.status, r.headers.get('content-type'), 'len', t.length, '｜head:', t.slice(0,80).replace(/\n/g,' '))
  } catch (e) { console.log(label, 'ERR', e.message) }
}
