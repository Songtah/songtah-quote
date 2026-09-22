import fs from 'fs'
const { listVisits } = await import('../lib/notion/visits.ts')
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const v = (await listVisits({ fetchAll: true })).items
fs.writeFileSync(SP + '/visit-all.json', JSON.stringify(v.map((x) => ({
  d: x.date, sp: x.salesperson, cid: (x.customerId || '').replace(/-/g, ''), n: x.customerName,
}))))
console.log('拜訪總筆數', v.length, '最早', v.map(x=>x.date).sort()[0])
