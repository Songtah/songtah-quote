const { getCodeNotFoundList } = await import('../lib/notion/medical-monitor.ts')
const r = await getCodeNotFoundList({ refresh: true })
const by = {}
for (const x of r.rows) by[x.kind] = (by[x.kind] ?? 0) + 1
console.log('去重後', r.rows.length, by)
console.log(r.rows.filter(x=>x.kind==='牙體技術所').slice(0,4).map(x=>`${x.customerName||x.name} ${x.code} ${x.recordedAt}`))
