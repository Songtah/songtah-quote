// URAWA 專用:官網已下架牙科產品線(2026現況 404),改用 Wayback Machine 存檔(2025-09/10 快照)。
// 只找到兩個組合頁存檔(UP500/UG33/VC60、G7-SET),涵蓋部分目標貨號;其餘型號官網當年也未必單獨列頁,查無存檔。
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

// 目標 code(去掉 UW- 前綴後對應)→ Wayback 全尺寸圖網址 + 來源頁
const MAP = {
  'UW-01': { img: 'http://web.archive.org/web/20250915123051im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/11/up500set-e1380775594586.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/up500-ug33-vc60/', label: 'UP500/UG33/VC60 組合圖(Wayback 存檔)' },
  'UW-01-1': { img: 'http://web.archive.org/web/20250915123051im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/11/up500set-e1380775594586.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/up500-ug33-vc60/', label: 'UP500/UG33/VC60 組合圖(Wayback 存檔)' },
  'UW-02': { img: 'http://web.archive.org/web/20250915123051im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/11/up500set-e1380775594586.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/up500-ug33-vc60/', label: 'UP500/UG33/VC60 組合圖(Wayback 存檔)' },
  'UW-03': { img: 'http://web.archive.org/web/20250915123051im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/11/up500set-e1380775594586.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/up500-ug33-vc60/', label: 'UP500/UG33/VC60 組合圖(Wayback 存檔)' },
  'UW-04': { img: 'http://web.archive.org/web/20250915123051im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/11/up500set-e1380775594586.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/up500-ug33-vc60/', label: 'UP500/UG33/VC60 組合圖(Wayback 存檔)' },
  'UW-12': { img: 'http://web.archive.org/web/20250915121738im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/12/g7setdental.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/g7-set/', label: 'G7-SET 組合圖(Wayback 存檔)' },
  'UW-13': { img: 'http://web.archive.org/web/20250915121738im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/12/g7setdental.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/g7-set/', label: 'G7-SET 組合圖(Wayback 存檔)' },
  'UW-14': { img: 'http://web.archive.org/web/20250915121738im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/12/g7setdental.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/g7-set/', label: 'G7-SET 組合圖(Wayback 存檔)' },
  'UW-14-1': { img: 'http://web.archive.org/web/20250915121738im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/12/g7setdental.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/g7-set/', label: 'G7-SET 組合圖(Wayback 存檔)' },
  'UW-16': { img: 'http://web.archive.org/web/20250915121738im_/https://www.urawa.co.jp/en/wp-content/uploads/2012/12/g7setdental.jpg', page: 'http://web.archive.org/web/20251005193829/https://www.urawa.co.jp/en/products/dental/g7-set/', label: 'G7-SET 組合圖(Wayback 存檔)' },
}

const { targets } = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'targets.json'), 'utf8'))
const list = targets.filter((t) => t.brand === 'URAWA')

async function download(url, dest) {
  const { stdout } = await execFileP('curl', ['-sL', '--max-time', '25', '-A', UA, '-o', dest, '-w', '%{http_code} %{size_download}', url])
  const [code, size] = stdout.trim().split(' ').map(Number)
  if (code !== 200 || size < 3000) throw new Error(`HTTP ${code} size ${size}`)
  return size
}

async function main() {
  let hit = 0
  for (const t of list) {
    const m = MAP[t.code]
    if (!m) { console.log(`✗ ${t.code} 查無 Wayback 存檔`); continue }
    try {
      const dir = path.join(WORKSPACE, 'candidates', t.id.replace(/[:\/]/g, '_'))
      fs.mkdirSync(dir, { recursive: true })
      const file = 'cand-1' + (path.extname(new URL(m.img).pathname) || '.jpg')
      const size = await download(m.img, path.join(dir, file))
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        target: t,
        candidates: [{ file, imageUrl: m.img, pageUrl: m.page, pageTitle: m.label, score: 0.8, bytes: size }],
      }, null, 1))
      hit++
      console.log(`✓ ${t.code}`)
    } catch (e) { console.log(`✗ ${t.code} ${e.message}`) }
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(`完成:${hit}/${list.length}`)
}
main()
