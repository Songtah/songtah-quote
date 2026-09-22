// 唯讀匯出：觀察期拜訪明細 + 客戶主檔輕量欄位，之後都在本機算，不再打 Notion
import fs from 'fs'
const { getAllSystemCustomers } = await import('../lib/notion/customers.ts')
const { listVisits } = await import('../lib/notion/visits.ts')
const SP = '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'

const customers = await getAllSystemCustomers()
fs.writeFileSync(SP + '/cust-dump.json', JSON.stringify(customers.map((c) => ({
  id: c.id.replace(/-/g, ''), name: c.name, city: c.city, district: c.district,
  type: c.type, sp: c.salesperson, status: c.status,
}))))

const v = (await listVisits({ dateFrom: '2025-09-01', dateTo: '2026-09-16', fetchAll: true })).items
fs.writeFileSync(SP + '/visit-dump.json', JSON.stringify(v.map((x) => ({
  d: x.date, sp: x.salesperson, cid: (x.customerId || '').replace(/-/g, ''), n: x.customerName,
}))))
console.log('客戶', customers.length, '拜訪', v.length)
