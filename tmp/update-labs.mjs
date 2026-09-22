// 依使用者提供的資料更新技工所地址與電話（雙北，公司既有客戶）。預設預覽，--apply 才寫入。
import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const db = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB
const APPLY = process.argv.includes('--apply')

// 名稱 / 地址 / 電話（使用者 2026-09-17 提供）
const DATA = [
  ['康紘牙體技術所', '新北市三重區中華路50巷1弄22號2樓', '02-2981-6266'],
  ['優藝牙體技術所', '新北市中和區保健路10巷3弄1號2樓', '02-2943-9990'],
  ['捷運景安美齒製作中心', '新北市中和區圓通路265巷45號1樓', '02-2247-5926'],
  ['新和齒科材料行', '新北市中和區景新路186號10樓', '02-2946-4789'],
  ['佑昇齒研', '新北市板橋區新生街23巷1弄6號5F', '02-2271-0686'],
  ['山佳牙體技術所', '新北市樹林區中山路3段241號1F', '0915-606266'],
  ['詠昇科技有限公司', '臺北市中山區民生東路三段19號12樓', '02-2517-7070'],
  ['愛迪生技股份有限公司', '臺北市中正區羅斯福路2段22號2樓', '02-3322-1004'],
  ['慶豐牙科技研', '臺北市信義區林口街109號2F', '02-2726-1176'],
  ['上禾牙體技術所', '臺北市內湖區環山路2段109巷3弄14號1樓', '0933-500986'],
  ['百匠牙體技術所', '臺北市內湖區南京東路6段109號3F', '0933-717219'],
  ['聯和陶齒', '臺北市內湖區內湖路1段629巷101弄7號2樓', '0921-642110'],
  ['益新牙藝齒模科技中心', '臺北市北投區建民路29巷1弄2號4F', '02-2822-5425'],
  ['士玉牙體技術所', '臺北市士林區福港街30巷3號', '02-2882-0178'],
  ['無名牙體技術所', '臺北市大安區忠孝東路四段1號3樓', '02-8771-0198'],
  ['盛光牙體技術所', '臺北市大安區樂業街65巷29號4F', '02-8732-4239'],   // 大安那筆（松山另有一家同名，不動）
  ['皇冠牙體技術所', '臺北市信義區基隆路2段189號5樓之1', '02-2732-4911'],
  ['合誠牙體技術所', '臺北市萬華區寶興街222巷9號5樓', '02-2303-3025'],
]

const txt = (p) => (p?.rich_text ?? []).map((t) => t.plain_text).join('').trim()
const norm = (s) => (s || '').replace(/\s/g, '').replace(/台/g, '臺')

for (const [name, addr, tel] of DATA) {
  const q = await notion.databases.query({
    database_id: db, filter: { property: '客戶名稱', title: { equals: name } },
  })
  const hits = q.results.filter((p) => !p.archived)
  if (hits.length === 0) { console.log(`❌ 找不到：${name}`); continue }
  // 同名多筆：用地址的行政區挑出正確那筆
  let page = hits[0]
  if (hits.length > 1) {
    const dist = addr.match(/[一-鿿]{1,3}區/)?.[0] ?? ''
    const pick = hits.find((p) => norm(txt(p.properties['地址'])).includes(norm(dist)) ||
      (p.properties['行政區']?.select?.name ?? txt(p.properties['行政區'])) === dist)
    if (!pick) { console.log(`⚠️ ${name} 有 ${hits.length} 筆同名且無法用行政區判斷，跳過`); continue }
    page = pick
    console.log(`ℹ️ ${name} 有 ${hits.length} 筆同名，依行政區 ${dist} 選定 ${page.id.slice(0, 8)}…`)
  }
  const P = page.properties
  const oldAddr = txt(P['地址']), oldTel = P['電話']?.phone_number ?? ''
  const addrChange = norm(oldAddr) !== norm(addr)
  const telChange = oldTel.replace(/\D/g, '') !== tel.replace(/\D/g, '')
  const 師 = P['牙體技術師數']?.number, 生 = P['牙體技術生數']?.number, code = txt(P['機構代碼'])
  console.log(`\n${name}`)
  console.log(`  地址 ${addrChange ? `「${oldAddr || '（空白）'}」→「${addr}」` : '不變'}`)
  console.log(`  電話 ${telChange ? `「${oldTel || '（空白）'}」→「${tel}」` : '不變'}`)
  console.log(`  師/生數 ${師 ?? '－'}/${生 ?? '－'}　機構代碼 ${code || '無'}`)
  if (!APPLY || (!addrChange && !telChange)) continue
  const props = {}
  if (addrChange) {
    props['地址'] = { rich_text: [{ text: { content: addr } }] }
    // 地址換區時，行政區欄位要跟著改，否則兩邊對不起來（皇冠：松山→信義）
    const newDist = addr.match(/[一-鿿]{1,2}區/)?.[0]
    const curDist = P['行政區']?.select?.name ?? txt(P['行政區'])
    if (newDist && curDist && newDist !== curDist) {
      props['行政區'] = P['行政區']?.type === 'select'
        ? { select: { name: newDist } }
        : { rich_text: [{ text: { content: newDist } }] }
      console.log(`  行政區 「${curDist}」→「${newDist}」`)
    }
  }
  if (telChange) props['電話'] = { phone_number: tel }
  await notion.pages.update({ page_id: page.id, properties: props })
  console.log('  ✓ 已更新')
}
console.log(APPLY ? '\n完成' : '\n預覽模式，未寫入。加 --apply 執行。')
