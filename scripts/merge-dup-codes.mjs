/**
 * 合併「機構代碼＋客戶名稱」完全相同的重複客戶。
 *  - 預設 dry-run 只印計畫；加 --execute 才寫入。
 *  - 刪除一律用 Notion archive（垃圾桶 30 天可還原）。
 *  - 代碼相同但名稱不同的組一律跳過（院區、科系、未立案是不同客戶）。
 *  - 保留者：關聯最多者；同分取建立最早者。
 *  - dup 在 7 個關聯庫的參照一律改連到保留者；dup 有值而保留者空白的欄位補到保留者。
 *  - 全程寫 log CSV（含還原用 page id）到 --log 指定路徑。
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { Client } from '@notionhq/client'
import { writeFile } from 'node:fs/promises'
const EXECUTE = process.argv.includes('--execute')
const LOG = process.argv[process.argv.indexOf('--log') + 1] || `merge-dup-codes-${Date.now()}.csv`
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const { DB } = await import('../lib/notion/shared.ts')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function call(fn) { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= 4 || e.code === 'validation_error' || e.code === 'object_not_found') throw e; await sleep(1500 * (i + 1)) } } }
async function scan(dbid, filter) { const o = []; let c; do { const r = await call(() => notion.databases.query({ database_id: dbid, page_size: 100, ...(filter ? { filter } : {}), ...(c ? { start_cursor: c } : {}) })); o.push(...r.results); c = r.has_more ? r.next_cursor : undefined } while (c); return o }
const txt = (p, k) => (p.properties?.[k]?.rich_text ?? p.properties?.[k]?.title ?? []).map(t => t.plain_text).join('').trim()

// 1. 找重複：依縣市分區掃客戶（避開一萬筆截斷）
const cdb = await notion.databases.retrieve({ database_id: DB.customers })
const pages = []
for (const o of cdb.properties['縣市'].select.options) pages.push(...await scan(DB.customers, { property: '縣市', select: { equals: o.name } }))
pages.push(...await scan(DB.customers, { property: '縣市', select: { is_empty: true } }))
const byCode = new Map()
for (const p of pages) { const code = txt(p, '機構代碼'); if (code) byCode.set(code, [...(byCode.get(code) ?? []), p]) }
const groups = [...byCode.entries()].filter(([, a]) => a.length > 1)
const sameName = groups.filter(([, a]) => new Set(a.map(p => txt(p, '客戶名稱'))).size === 1)
const skipped = groups.filter(([, a]) => new Set(a.map(p => txt(p, '客戶名稱'))).size > 1)
console.log(`客戶 ${pages.length} 筆；代碼重複 ${groups.length} 組；同名可合併 ${sameName.length} 組；名稱不同跳過 ${skipped.length} 組（${skipped.map(([c]) => c).join('、')}）`)

// 2. 每個候選頁在 7 個關聯庫的參照
const REL = [[DB.visits, '🏥 牙科單位資料', '客情'], [DB.tickets, '🏥 牙科單位資料', '工單'], [DB.equipment, '客戶名稱', '設備'], [DB.registrations, '客戶配對', '報名'], [DB.campaignMembers, '客戶', '名單'], [DB.crossSupport, '客戶', '跨區'], [DB.collabPoints, '客戶', '積分']]
async function refsOf(pageId) { const out = []; for (const [dbid, prop, label] of REL) { if (!dbid) continue; for (const r of await scan(dbid, { property: prop, relation: { contains: pageId } })) out.push({ dbid, prop, label, page: r }) } return out }

const plan = [], log = [['組', '動作', '客戶名稱', '機構代碼', 'page_id', '參照數', '補欄位', '備註']]
for (const [code, arr] of sameName) {
  const withRefs = []
  for (const p of arr) withRefs.push({ p, refs: await refsOf(p.id) })
  withRefs.sort((a, b) => b.refs.length - a.refs.length || a.p.created_time.localeCompare(b.p.created_time))
  const keeper = withRefs[0], dups = withRefs.slice(1)
  for (const d of dups) {
    // 補欄位：dup 有值、keeper 空白的（只處理簡單型別）
    const fill = {}
    for (const [k, v] of Object.entries(d.p.properties)) {
      const kv = keeper.p.properties[k]; if (!kv || ['formula', 'rollup', 'created_time', 'last_edited_time', 'title', 'relation'].includes(v.type)) continue
      const has = x => x.type === 'checkbox' ? x.checkbox : Array.isArray(x[x.type]) ? x[x.type].length > 0 : x[x.type] != null && x[x.type] !== ''
      if (has(v) && !has(kv)) fill[k] = v.type === 'rich_text' ? { rich_text: v.rich_text.map(t => ({ type: 'text', text: { content: t.plain_text } })) } : v.type === 'multi_select' ? { multi_select: v.multi_select.map(o => ({ name: o.name })) } : v.type === 'select' ? { select: { name: v.select.name } } : { [v.type]: v[v.type] }
    }
    plan.push({ code, name: txt(keeper.p, '客戶名稱'), keeper, dup: d, fill })
    log.push([code, '保留', txt(keeper.p, '客戶名稱'), code, keeper.p.id, keeper.refs.length, '', ''])
    log.push([code, EXECUTE ? '封存' : '計畫封存', txt(d.p, '客戶名稱'), code, d.p.id, d.refs.length, Object.keys(fill).join('|'), d.refs.map(r => r.label).join('|')])
  }
}
const totalRefs = plan.reduce((n, x) => n + x.dup.refs.length, 0), totalFill = plan.filter(x => Object.keys(x.fill).length).length
console.log(`計畫：封存 ${plan.length} 筆；需改連參照 ${totalRefs} 筆；需補欄位 ${totalFill} 筆`)
for (const x of plan) console.log(`  ${x.code} ${x.name}｜保留 ${x.keeper.p.created_time.slice(0, 10)}（參照 ${x.keeper.refs.length}）｜封存 ${x.dup.p.created_time.slice(0, 10)}（參照 ${x.dup.refs.length}${x.dup.refs.length ? '：' + x.dup.refs.map(r => r.label).join('、') : ''}）${Object.keys(x.fill).length ? '｜補 ' + Object.keys(x.fill).join('、') : ''}`)

if (EXECUTE) {
  let done = 0
  for (const x of plan) {
    // 重新確認 dup 仍存在且未封存、名稱與代碼未變
    const fresh = await call(() => notion.pages.retrieve({ page_id: x.dup.p.id }))
    if (fresh.archived || txt(fresh, '機構代碼') !== x.code || txt(fresh, '客戶名稱') !== x.name) { console.log(`  跳過 ${x.name}：狀態已變`); continue }
    for (const r of x.dup.refs) {
      const ids = r.page.properties[r.prop].relation.map(z => z.id).filter(id => id !== x.dup.p.id)
      if (!ids.includes(x.keeper.p.id)) ids.push(x.keeper.p.id)
      await call(() => notion.pages.update({ page_id: r.page.id, properties: { [r.prop]: { relation: ids.map(id => ({ id })) } } }))
    }
    if (Object.keys(x.fill).length) await call(() => notion.pages.update({ page_id: x.keeper.p.id, properties: x.fill }))
    await call(() => notion.pages.update({ page_id: x.dup.p.id, archived: true }))
    done++
  }
  console.log(`已封存 ${done} 筆`)
}
await writeFile(LOG, '﻿' + log.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
console.log(`log：${LOG}${EXECUTE ? '' : '（dry-run，未寫入任何資料）'}`)
