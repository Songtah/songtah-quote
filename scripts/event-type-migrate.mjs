/**
 * 活動類型遷移：新增「課程」選項，並將既有「培訓」改為「課程」。
 *
 * 用法（比照 scripts/dev-stage-migrate.mjs 慣例）：
 *   node scripts/event-type-migrate.mjs            # audit 模式，唯讀，只列出受影響筆數與新舊值
 *   node scripts/event-type-migrate.mjs --apply    # 實際寫入
 *
 * 規則：只動 培訓 → 課程。研討會／產品發表／展覽／其他一律不動。
 */
import { Client } from '@notionhq/client'
import fs from 'fs'

const APPLY = process.argv.includes('--apply')
const FROM = '培訓'
const TO   = '課程'

function loadEnv() {
  const out = {}
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      if (!(k in out)) out[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const notion = new Client({ auth: env.NOTION_TOKEN })
const EVENTS = env.NOTION_EVENTS_DB || '36dc5ca6467a46c299e2fe6efe5ab05e'

async function queryAll(db) {
  const out = []
  let cursor
  do {
    const r = await notion.databases.query({ database_id: db, start_cursor: cursor, page_size: 100 })
    out.push(...r.results)
    cursor = r.next_cursor
  } while (cursor)
  return out
}

const title = (p) => p.properties['活動名稱']?.title?.[0]?.plain_text ?? '(無名)'
const type  = (p) => p.properties['活動類型']?.select?.name ?? ''
const date  = (p) => p.properties['日期']?.date?.start?.slice(0, 10) ?? ''

console.log(APPLY ? '=== APPLY 模式：會實際寫入 ===\n' : '=== AUDIT 模式：唯讀，不寫入任何資料 ===\n')

// 1. schema 現況
const db = await notion.databases.retrieve({ database_id: EVENTS })
const opts = db.properties['活動類型']?.select?.options ?? []
const optNames = opts.map(o => o.name)
console.log('活動類型 select 現有選項：', optNames.join('、'))
const needAddOption = !optNames.includes(TO)
console.log(`是否需要新增「${TO}」選項：`, needAddOption ? '是' : '否（已存在）')

// 2. 受影響筆數與新舊值
const pages = await queryAll(EVENTS)
const affected = pages.filter(p => type(p) === FROM)
const untouched = pages.filter(p => type(p) !== FROM)

console.log(`\n活動總筆數：${pages.length}`)
console.log(`受影響（${FROM} → ${TO}）：${affected.length} 筆`)
console.log(`不動：${untouched.length} 筆\n`)

console.log(`--- 將被修改的 ${affected.length} 筆 ---`)
affected.forEach((p, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${date(p)}  ${title(p).slice(0, 30).padEnd(32)} ${FROM} → ${TO}`)
})

console.log(`\n--- 維持不動的 ${untouched.length} 筆 ---`)
untouched.forEach((p, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${date(p)}  ${title(p).slice(0, 30).padEnd(32)} ${type(p) || '(空白)'}`)
})

if (!APPLY) {
  console.log('\n以上為 audit 結果，未寫入任何資料。')
  console.log('確認無誤後執行：node scripts/event-type-migrate.mjs --apply')
  process.exit(0)
}

// 3. 寫入
if (needAddOption) {
  console.log(`\n新增 select 選項「${TO}」…`)
  await notion.databases.update({
    database_id: EVENTS,
    properties: { '活動類型': { select: { options: [...opts, { name: TO }] } } },
  })
  console.log('  完成（既有選項全數保留）')
}

let ok = 0, fail = 0
for (const p of affected) {
  try {
    await notion.pages.update({ page_id: p.id, properties: { '活動類型': { select: { name: TO } } } })
    ok++
    console.log(`  ✓ ${title(p).slice(0, 30)}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${title(p).slice(0, 30)} — ${e.message}`)
  }
}

// 4. read-back 驗證
const after = await queryAll(EVENTS)
const dist = {}
for (const p of after) { const t = type(p) || '(空白)'; dist[t] = (dist[t] || 0) + 1 }
console.log(`\n寫入完成：成功 ${ok}、失敗 ${fail}`)
console.log('read-back 類型分布：')
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`))
console.log(`總筆數 ${after.length}（遷移前 ${pages.length}）`, after.length === pages.length ? '✓ 無遺失' : '✗ 筆數不符')
