// 一次性遷移:decisions.json 從單選(file/dir/imageUrl/pageUrl)改成複選(picks 陣列)
// 用法:node scripts/image-hunt/migrate-picks.mjs
import fs from 'fs'
import path from 'path'

const WORKSPACE = '/Users/ted/Desktop/Songtah/產品圖片工作區'
const DECISIONS = path.join(WORKSPACE, 'decisions.json')

const decisions = JSON.parse(fs.readFileSync(DECISIONS, 'utf8'))
let migrated = 0
for (const [id, d] of Object.entries(decisions)) {
  if (d.file && !d.picks) {
    const { file, dir, imageUrl, pageUrl, ...rest } = d
    decisions[id] = { ...rest, picks: [{ dir, file, imageUrl, pageUrl }] }
    migrated++
  }
}
fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 1))
console.log(`遷移完成:${migrated} 筆單選決策轉為 picks 陣列(總決策數 ${Object.keys(decisions).length})`)
