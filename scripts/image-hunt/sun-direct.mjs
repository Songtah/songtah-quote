// SUN Oberflächentechnik 專用:官網是 Webflow SPA 沒有可爬的清單頁,
// 但我們的貨號(去掉 SUN- 前綴、"/"→"-"、轉小寫)直接對上官網網址 /product-lists-en/<code>,
// 頁面內有 <div class="ref">CODE</div> 可核對、圖檔名內嵌貨號,比對準確率接近 100%。
// 用法:node scripts/image-hunt/sun-direct.mjs → 直接產生候選圖(略過 crawl.mjs/match.mjs)
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))
const list = targets.filter((t) => t.brand === 'SUN Oberflächentechnik')

async function get(url) {
  const { stdout } = await execFileP('curl', ['-sL', '--max-time', '20', '-A', UA, url], { maxBuffer: 20 * 1024 * 1024 })
  return stdout
}
async function download(url, dest) {
  const { stdout } = await execFileP('curl', ['-sL', '--max-time', '20', '-A', UA, '-o', dest, '-w', '%{http_code} %{size_download}', url])
  const [code, size] = stdout.trim().split(' ').map(Number)
  if (code !== 200 || size < 3000) throw new Error(`HTTP ${code} size ${size}`)
  return size
}

async function main() {
  let hit = 0
  for (const t of list) {
    const slug = t.code.replace(/^SUN-/, '').replace(/\//g, '-').toLowerCase()
    const url = `https://www.sun-dental.de/product-lists-en/${slug}`
    try {
      const html = await get(url)
      const refMatch = html.match(/<div class="ref">([^<]+)<\/div>/)
      if (!refMatch) { console.log(`✗ ${t.code} 無此頁`); continue }
      const imgs = [...html.matchAll(/class="img_main-img"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*class="img_main-img"/g)]
      let imgUrl = imgs[0]?.[1] || imgs[0]?.[2]
      if (!imgUrl) {
        const alt = html.match(/class="img_produktbild_1"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*class="img_produktbild_1"/)
        imgUrl = alt?.[1] || alt?.[2]
      }
      if (!imgUrl) { console.log(`✗ ${t.code} 有頁面但找不到主圖`); continue }
      const dir = path.join(WORKSPACE, 'candidates', t.id.replace(/[:\/]/g, '_'))
      fs.mkdirSync(dir, { recursive: true })
      const file = 'cand-1' + (path.extname(new URL(imgUrl).pathname) || '.png')
      const size = await download(imgUrl, path.join(dir, file))
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        target: t,
        candidates: [{ file, imageUrl: imgUrl, pageUrl: url, pageTitle: `${t.name}(貨號直連:${refMatch[1]})`, score: 1, bytes: size }],
      }, null, 1))
      hit++
      console.log(`✓ ${t.code} → ${refMatch[1]}`)
    } catch (e) {
      console.log(`✗ ${t.code} ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(`完成:${hit}/${list.length} 個目標貨號直連成功`)
}

main()
