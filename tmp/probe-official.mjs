const { fetchOfficialRecent } = await import('../lib/tender-official.ts')
const { matchKeywords } = await import('../lib/tender-source.ts')
const t0=Date.now()
const { records, periods } = await fetchOfficialRecent(4)
console.log('期別', periods.join('、'), '｜總筆數', records.length, `｜${((Date.now()-t0)/1000).toFixed(0)} 秒`)
const dental = records.filter(r => matchKeywords({ title: r.title, unitName: r.unitName, category: r.procurementAttr }))
console.log('牙科相關', dental.length, '（招標', dental.filter(r=>r.kind==='tender').length, '／決標', dental.filter(r=>r.kind==='award').length, '）')
for (const r of dental.slice(0,8)) {
  console.log(` ${r.date} [${r.kind==='award'?'決標':'招標'}] ${r.unitName}｜${r.title}${r.awardAmount?`｜${r.awardAmount.toLocaleString()}元｜得標:${r.winners.join(',')}`:''}`)
}
