// 把誤掛在「負責業務＝盤商」的實體醫事機構改回「公司」（中央待分派池）
// 預設只預覽；加 --apply 才寫入。寫入走 reassignSalesperson（逐筆重讀、仍為盤商才改）。
const { getAllSystemCustomers, reassignSalesperson } = await import('../lib/notion/customers.ts')
const APPLY = process.argv.includes('--apply')

// 名稱看得出是實體醫事機構才移動；材料行／器材行／科技公司／工會學會一律留在盤商
const INST = /(牙體技術所|齒研所|齒體技術所|牙醫診所|齒科診所|醫院|衛生所|牙醫學系)$/
const EXCLUDE = /(材料行|器材行|儀器行|工會|學會|貿易|實業|企業|鑽針)/

const all = await getAllSystemCustomers()
const dealers = all.filter((c) => c.salesperson === '盤商')
const move = dealers.filter((c) =>
  INST.test(c.name) && !EXCLUDE.test(c.name) && !['停業', '已歇業', '撤銷'].includes(c.status))

console.log(`盤商名下 ${dealers.length} 家 → 判定為實體醫事機構、要移回「公司」的有 ${move.length} 家`)
for (const c of move) console.log(`  ${c.type || '未分類'}\t${c.city}\t${c.name}`)
const keep = dealers.filter((c) => !move.includes(c))
console.log(`\n維持盤商 ${keep.length} 家（同業/材料行/科技公司/個人/已歇業）`)

if (!APPLY) { console.log('\n預覽模式，未寫入。加 --apply 才執行。'); process.exit(0) }
const res = await reassignSalesperson(move.map((c) => c.id), '盤商', '公司')
console.log(`\n已改 ${res.reassigned} 家；跳過 ${res.skipped.length} 家`)
for (const s of res.skipped) console.log('  跳過', s.name, '現值', s.current)
