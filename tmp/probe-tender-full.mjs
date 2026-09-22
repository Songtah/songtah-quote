const { refreshTenders } = await import('../lib/notion/tenders.ts')
const t0 = Date.now()
const snap = await refreshTenders({ days: 30, full: true })
console.log(`掃 ${snap.scannedDays} 天、${snap.scannedRecords} 則公告 → DB 內共 ${snap.records.length} 案，耗時 ${((Date.now()-t0)/1000).toFixed(0)} 秒`)
console.log('比對到客戶：', snap.records.filter(r=>r.customerId).length, '｜崧達曾投標：', snap.records.filter(r=>r.weBid).length)
for (const r of snap.records.slice(0,8)) {
  console.log(` ${r.date} [${r.type}] ${r.unitName}｜${r.title}｜預算${r.budget??'—'}｜得標${r.winner||'—'}｜狀態${r.status}`)
}
