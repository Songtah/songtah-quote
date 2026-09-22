import fs from 'fs'
const { getAllSystemCustomers } = await import('../lib/notion/customers.ts')
const SP='/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const c = await getAllSystemCustomers()
fs.writeFileSync(SP+'/cust-dump.json', JSON.stringify(c.map(x=>({id:x.id.replace(/-/g,''),name:x.name,city:x.city,district:x.district,type:x.type,sp:x.salesperson,status:x.status}))))
console.log('客戶', c.length, '｜公司', c.filter(x=>x.salesperson==='公司').length, '｜盤商', c.filter(x=>x.salesperson==='盤商').length)
