// 產品圖片獵取:全品牌重新爬取+比對(2026-07-21 使用者要求全量重跑,套用新比對邏輯)
// 用法:node scripts/image-hunt/rerun-all.mjs
// 依序對每個有官網爬蟲設定的品牌跑 crawl.mjs → match.mjs;單一品牌失敗不中斷整批。
// match.mjs 已內建保護:已選圖(decisions.json 有 file)的目標永遠跳過,不會覆蓋既有進度。
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))

const BRANDS = [
  'zirkonzahn', 'gc', 'schottlander', 'denken', 'songyoung', 'mestra',
  'yamahachi', 'keystone', 'whipmix', 'saeyang', 'detax', 'yamakin',
  'besmile', 'dekema', 'cadstar', 'ugin', 'asiga',
]

function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { cwd: path.resolve(SCRIPTS_DIR, '../..') })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('exit', (code) => resolve({ code, out: out.trim() }))
  })
}

async function main() {
  const started = Date.now()
  for (const [i, brand] of BRANDS.entries()) {
    console.log(`\n[${i + 1}/${BRANDS.length}] ${brand} — 爬取官網…`)
    const crawlResult = await run(path.join(SCRIPTS_DIR, 'crawl.mjs'), [brand])
    if (crawlResult.code !== 0) {
      console.log(`  ⚠️ 爬取失敗,跳過此品牌:${crawlResult.out.slice(-300)}`)
      continue
    }
    console.log(`  ✓ 爬取完成`)
    console.log(`  比對候選圖…`)
    const matchResult = await run(path.join(SCRIPTS_DIR, 'match.mjs'), [brand])
    console.log(`  ${matchResult.out.split('\n').pop()}`)
  }
  const mins = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`\n全部完成,耗時 ${mins} 分鐘`)
}

main()
