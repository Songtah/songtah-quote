// 產品圖片獵取:第二步 — 爬品牌官網產品頁建索引(每品牌一次)
// 用法:node scripts/image-hunt/crawl.mjs <brandKey>
// 輸出:工作區/brand-index/<brandKey>.json = [{url, title, images[]}]
// 禮貌原則:同站併發 2、每請求間隔 400ms、只抓 allow 範圍、上限 maxPages

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const SITES = {
  zirkonzahn: {
    origin: 'https://zirkonzahn.com',
    // 2026-07-21 查證:1211 個 SKU 只索引到 145 頁,覆蓋率嚴重不足——但補了 sitemap.xml 撈到的
    // 12 個分類入口後實測 0 頁新增,證實不是「進入點不夠」,而是這個瓶頸:大量個別色號/規格頁面
    // 本身就不是獨立可爬的靜態連結(圖片很可能是色號選擇器用 JS 換 src,同一個 URL 底下切換),
    // 靠 curl 抓 <a href> 這類靜態爬蟲天生碰不到。要提高覆蓋率需要換成能執行 JS 的無頭瀏覽器
    // (如 Playwright),是另一個要單獨評估的較大改動,這裡先不動 start 清單。
    start: ['https://zirkonzahn.com/en/products'],
    allow: /^https:\/\/zirkonzahn\.com\/en\/products/,
    maxPages: 900,
  },
  yamahachi: {
    // 有英文版!/en/ 路徑下產品名稱是乾淨英文(EFC-A/Crown PX/Basis 等),不必再靠人工翻譯日文 slug。
    origin: 'https://yamahachi-dental.co.jp',
    start: ['https://yamahachi-dental.co.jp/en/products_category/artificial-teeth/', 'https://yamahachi-dental.co.jp/en/products_category/3d-print-materials/', 'https://yamahachi-dental.co.jp/en/products_category/abrasive-materials-polishing-materials/', 'https://yamahachi-dental.co.jp/en/products_category/attachment/', 'https://yamahachi-dental.co.jp/en/products_category/cadcam-milling-materials/', 'https://yamahachi-dental.co.jp/en/products_category/laboratory-equipments/', 'https://yamahachi-dental.co.jp/en/products_category/other-materials-lab-side/', 'https://yamahachi-dental.co.jp/en/products_category/separating-agent-and-cleansing-agent/', 'https://yamahachi-dental.co.jp/en/products_category/synthetic-resin/', 'https://yamahachi-dental.co.jp/en/products_category/waxes/'],
    allow: /^https:\/\/yamahachi-dental\.co\.jp\/en\/(products|products_category)\//,
    maxPages: 300,
  },
  schottlander: {
    origin: 'https://www.schottlander.com',
    start: ['https://www.schottlander.com/categories/laboratory-products/'],
    allow: /^https:\/\/www\.schottlander\.com\/categories\//,
    maxPages: 400,
  },
  gc: {
    origin: 'https://www.gc.dental',
    start: ['https://www.gc.dental/america/products/laboratory', 'https://www.gc.dental/america/products/operatory'],
    allow: /^https:\/\/www\.gc\.dental\/america\/products\//,
    maxPages: 900,
  },
  denken: {
    origin: 'https://denken-highdental.co.jp',
    start: ['https://denken-highdental.co.jp/en/product/'],
    allow: /^https:\/\/denken-highdental\.co\.jp\/en\/(dental-equipments_en|dental-materials_en|dental-clinic-items_en|product-riken)\//,
    maxPages: 400,
  },
  songyoung: {
    origin: 'https://songyoung.com.tw',
    start: ['https://songyoung.com.tw/products.php?CID=1', 'https://songyoung.com.tw/products.php?CID=2', 'https://songyoung.com.tw/products.php?CID=3', 'https://songyoung.com.tw/products.php?CID=4'],
    allow: /^https:\/\/songyoung\.com\.tw\/products\.php\?CID=\d+(&PID=\d+)?$/,
    extraHeaders: { Referer: 'https://songyoung.com.tw/' },
    maxPages: 300,
  },
  ugin: {
    origin: 'https://ugindentaire.fr',
    start: ['https://ugindentaire.fr/en/our-products/'],
    allow: /^https:\/\/ugindentaire\.fr\/en\/our-products\//,
    maxPages: 60,
  },
  cadstar: {
    origin: 'https://www.cadstar.dental',
    start: ['https://www.cadstar.dental/en/products/lab-systems/', 'https://www.cadstar.dental/en/products/clinic-systems/'],
    allow: /^https:\/\/www\.cadstar\.dental\/en\/products\//,
    maxPages: 60,
  },
  asiga: {
    origin: 'https://www.asiga.com',
    start: ['https://www.asiga.com/materials-dental/', 'https://www.asiga.com/3d-printers/'],
    allow: /^https:\/\/www\.asiga\.com\/(materials-dental|3d-printers)\/?$/,
    figureMode: true,
    maxPages: 10,
  },
  dekema: {
    origin: 'https://www.dekema.com',
    start: ['https://www.dekema.com/en/products'],
    allow: /^https:\/\/www\.dekema\.com\/en\/products\//,
    maxPages: 60,
  },
  saeyang: {
    origin: 'https://www.saeshin.us',
    start: ['https://www.saeshin.us/product-category/dental-lab/', 'https://www.saeshin.us/product-category/dental-air-driven-hp/'],
    allow: /^https:\/\/www\.saeshin\.us\/(product|product-category)\//,
    maxPages: 200,
  },
  detax: {
    origin: 'https://www.detax.com',
    start: ['https://www.detax.com/dental'],
    allow: /^https:\/\/www\.detax\.com\/dental\/product\//,
    maxPages: 200,
  },
  keystone: {
    origin: 'https://dental.keystoneindustries.com',
    start: ['https://dental.keystoneindustries.com/product-category/dental-lab/'],
    allow: /^https:\/\/dental\.keystoneindustries\.com\/product(-category)?\//,
    maxPages: 300,
  },
  mestra: {
    origin: 'https://mestra.es',
    start: ['https://mestra.es/en/product-categorie/laboratory/', 'https://mestra.es/en/product-categorie/clinic/'],
    allow: /^https:\/\/mestra\.es\/en\/(product-categorie|producto)\//,
    maxPages: 500,
  },
  whipmix: {
    origin: 'https://whipmix.com',
    start: ['https://whipmix.com/our-products/lab-supplies/', 'https://whipmix.com/our-products/'],
    allow: /^https:\/\/whipmix\.com\/(our-products|products)\//,
    pairMode: true,
    maxPages: 60,
  },
  besmile: {
    // 改用新官網 bsmdental.com(英文版,分類更完整,卡片結構同款)
    origin: 'https://www.bsmdental.com',
    start: ['https://www.bsmdental.com/product/124.html', 'https://www.bsmdental.com/product/125.html', 'https://www.bsmdental.com/product/126.html', 'https://www.bsmdental.com/product/127.html', 'https://www.bsmdental.com/product/128.html', 'https://www.bsmdental.com/product/130.html', 'https://www.bsmdental.com/product/131.html', 'https://www.bsmdental.com/product/242.html', 'https://www.bsmdental.com/product/244.html', 'https://www.bsmdental.com/product/253.html', 'https://www.bsmdental.com/product/271.html', 'https://www.bsmdental.com/product/276.html', 'https://www.bsmdental.com/product/277.html', 'https://www.bsmdental.com/product/281.html', 'https://www.bsmdental.com/product/284.html', 'https://www.bsmdental.com/product/285.html', 'https://www.bsmdental.com/product/320.html'],
    allow: /^https:\/\/www\.bsmdental\.com\/product\/\d+(\/\d+)?\.html$/,
    cardMode: true,
    maxPages: 60,
  },
  yamakin: {
    origin: 'https://www.yamakin-global.com',
    start: ['https://www.yamakin-global.com/products.html'],
    allow: /^https:\/\/www\.yamakin-global\.com\//,
    cardMode: true,
    maxPages: 10,
  },
}

const brandKey = process.argv[2]
const site = SITES[brandKey]
if (!site) { console.error('未知品牌,可用:', Object.keys(SITES).join(', ')); process.exit(1) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 部分站台(Cloudflare 等)對 Node fetch() 的流量指紋回應精簡版頁面(缺產品連結),
// curl 較貼近真實瀏覽器行為,穩定性更好,故一律走 curl 子行程。
const { execFile } = await import('child_process')
const { promisify } = await import('util')
const execFileP = promisify(execFile)

async function get(url, extraHeaders = {}) {
  const headers = { 'Accept-Language': 'en,ja;q=0.8,zh-TW;q=0.7', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...extraHeaders }
  const args = ['-sL', '--max-time', '25', '-A', UA]
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  args.push(url)
  const { stdout } = await execFileP('curl', args, { maxBuffer: 20 * 1024 * 1024 })
  if (!stdout || stdout.length < 50) throw new Error('空回應')
  return stdout
}

function absUrl(href, base) {
  try { return new URL(href, base).href.split('#')[0] } catch { return null }
}

function extractLinks(html, base) {
  const out = new Set()
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const u = absUrl(m[1].replace(/&amp;/g, '&'), base)
    if (u && u.startsWith(site.origin)) out.add(u.replace(/\/$/, ''))
  }
  return [...out]
}

// sns/share/og-default:社群分享縮圖常是固定的公司 LOGO 圖,不是產品照(YAMAHACHI 每頁 og:image 都指到同一張 sns.png 蓋掉真圖,曾誤判)
const IMG_SKIP = /logo|icon|flag|social|\bsns\b|share|banner|arrow|sprite|placeholder|loading|pixel|badge|button|avatar|\bnav[_-]|\bheader[_-]|\bfooter[_-]|\bbtn[_-]|\.svg(\?|$)/i
// UI 主題圖示幾乎都放在 themes/assets 資料夾,真正的產品照多半在 uploads/media 資料夾;
// 兩者都存在時只信任 uploads,避免 header/footer/nav 小圖示混進候選(YAMAHACHI 曾發生,關鍵字擋不完全)
function preferUploads(urls) {
  const uploads = urls.filter((u) => /\/(wp-content\/uploads|media|assets\/uploads|files)\//i.test(u))
  return uploads.length ? uploads : urls
}
function extractImages(html, base) {
  const imgs = new Set()
  // 內文 <img> 優先(較貼近實際產品照);og:image 常是固定分享縮圖,只當備援放最後
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src)="([^"]+)"/gi)) {
    const u = absUrl(m[1].replace(/&amp;/g, '&'), base)
    // 一般結尾為副檔名;但部分站台走縮圖服務(如 timthumb.php?src=xxx.jpg),副檔名落在查詢字串中間,故不錨定結尾
    if (u && /\.(jpe?g|png|webp)/i.test(u) && !IMG_SKIP.test(u)) imgs.add(u)
  }
  for (const m of html.matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/gi)) {
    const u = absUrl(m[1], base); if (u && !IMG_SKIP.test(u)) imgs.add(u)
  }
  return preferUploads([...imgs]).slice(0, 8)
}

function clean(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}
function extractTitle(html) {
  // 優先 og:title/title(通常是真標題);h1 常被拿去包 logo 圖(如 DENKEN),清完標籤可能是空字串,放最後備援
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  for (const m of [og, tt, h1]) {
    const c = clean(m?.[1])
    if (c) return c
  }
  return ''
}

// 卡片模式:部分站台一頁列多個產品(如貝施美分類頁),抓 <a href>…<img>…<h3/h4>名稱…</a> 重複區塊,
// 每張卡當成一個獨立「頁面」(title=卡片名稱,images=卡片圖),而非整頁只取一個標題。
function extractCards(html, base) {
  const cards = []
  for (const m of html.matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const block = m[2]
    if (block.length > 2000) continue // 太大代表誤吃到外層容器,跳過
    const img = block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i)
    const name = block.match(/<h[3-4][^>]*>([\s\S]*?)<\/h[3-4]>/i)
    const title = clean(name?.[1])
    const imgUrl = img ? absUrl(img[1].replace(/&amp;/g, '&'), base) : null
    if (title && imgUrl && /\.(jpe?g|png|webp)/i.test(imgUrl) && !IMG_SKIP.test(imgUrl)) {
      cards.push({ url: absUrl(m[1], base) || base, title, images: [imgUrl] })
    }
  }
  return cards
}

// 配對模式:部分站台圖片與標題各自獨立 <a href> 包裹、共用同一網址(如 Whip Mix 的頁面產生器),
// card-mode 要求圖+標題同一個 <a> 內故抓不到;改為分別收集 (href→img) 與 (href→title),依 href 配對。
function extractPairs(html, base) {
  const imgByHref = new Map()
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*<img[^>]+(?:src|data-src)="([^"]+)"/gi)) {
    const href = absUrl(m[1].replace(/&amp;/g, '&'), base)
    const img = absUrl(m[2].replace(/&amp;/g, '&'), base)
    if (href && img && /\.(jpe?g|png|webp)/i.test(img) && !IMG_SKIP.test(img)) imgByHref.set(href, img)
  }
  const cards = []
  for (const m of html.matchAll(/<h[2-4][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[2-4]>/gi)) {
    const href = absUrl(m[1].replace(/&amp;/g, '&'), base)
    const title = clean(m[2])
    if (href && title && imgByHref.has(href)) cards.push({ url: href, title, images: [imgByHref.get(href)] })
  }
  return cards
}

// 相簿模式:部分站台(如 Elementor 圖庫小工具)用 <figure><img>...<figcaption>名稱</figcaption></figure> 標示每張產品圖,
// 圖與名稱同在一個 figure 區塊內,結構比 card-mode(需要 <a> 包裹)更單純。
function extractFigures(html, base) {
  const cards = []
  for (const m of html.matchAll(/<figure[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const block = m[1]
    if (block.length > 3000) continue
    const img = block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i)
    const cap = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
    const title = clean(cap?.[1])
    const imgUrl = img ? absUrl(img[1].replace(/&amp;/g, '&'), base) : null
    if (title && imgUrl && /\.(jpe?g|png|webp)/i.test(imgUrl) && !IMG_SKIP.test(imgUrl)) {
      cards.push({ url: base, title, images: [imgUrl] })
    }
  }
  return cards
}

async function main() {
  const fs = await import('fs')
  const path = await import('path')
  const queue = [...site.start.map((u) => u.replace(/\/$/, ''))]
  if (site.sitemap) {
    try {
      const xml = await get(site.sitemap)
      // 支援 sitemap index(一層)
      const subs = [...xml.matchAll(/<loc>([^<]+sitemap[^<]*\.xml)<\/loc>/gi)].map((m) => m[1])
      const xmls = subs.length ? await Promise.all(subs.slice(0, 10).map((u) => get(u).catch(() => ''))) : [xml]
      for (const x of xmls) for (const m of x.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const u = m[1].trim().replace(/\/$/, '')
        if (site.allow.test(u + '/') || site.allow.test(u)) queue.push(u)
      }
      console.log(`sitemap 取得 ${queue.length} 個起點`)
    } catch (e) { console.log('sitemap 失敗(改用 BFS):', e.message) }
  }

  const seen = new Set()
  const pages = []
  let fetched = 0
  while (queue.length && fetched < site.maxPages) {
    const batch = []
    while (batch.length < 2 && queue.length) {
      const u = queue.shift()
      if (!seen.has(u)) { seen.add(u); batch.push(u) }
    }
    if (!batch.length) continue
    await Promise.all(batch.map(async (url) => {
      try {
        const html = await get(url, site.extraHeaders)
        fetched++
        if (site.figureMode) {
          pages.push(...extractFigures(html, url))
        } else if (site.pairMode) {
          pages.push(...extractPairs(html, url))
        } else if (site.cardMode) {
          pages.push(...extractCards(html, url))
        } else {
          const title = extractTitle(html)
          const images = extractImages(html, url)
          if (title && images.length) pages.push({ url, title, images })
        }
        for (const link of extractLinks(html, url)) {
          if ((site.allow.test(link) || site.allow.test(link + '/')) && !seen.has(link)) queue.push(link)
        }
        if (fetched % 50 === 0) console.log(`…已抓 ${fetched} 頁(有效 ${pages.length},佇列 ${queue.length})`)
      } catch { /* 忽略單頁失敗 */ }
    }))
    await sleep(400)
  }

  const dir = path.join(WORKSPACE, 'brand-index')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${brandKey}.json`), JSON.stringify({ crawledAt: new Date().toISOString(), origin: site.origin, pages }, null, 1))
  console.log(`完成:${brandKey} 抓 ${fetched} 頁,有效產品頁 ${pages.length} → brand-index/${brandKey}.json`)
}

main()
