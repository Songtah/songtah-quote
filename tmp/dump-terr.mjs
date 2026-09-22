const { listTerritories } = await import('../lib/notion/territories.ts')
import fs from 'fs'
const SP='/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const t = await listTerritories({ includeEnded: true })
fs.writeFileSync(SP+'/territories.json', JSON.stringify(t))
const by = {}
for (const x of t) (by[x.salesperson] ??= []).push(`${x.city}${x.district}(${x.status})`)
console.log('轄區筆數', t.length)
for (const [k,v] of Object.entries(by)) console.log(' ', k, v.length, '區：', v.slice(0,12).join('、'), v.length>12?'…':'')
