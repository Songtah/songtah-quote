const { getCachedMonitorResult } = await import('../lib/notion/medical-monitor.ts')
const r = await getCachedMonitorResult()
if (!r) { console.log('沒有快取結果'); process.exit(0) }
console.log('計算時間', r.computedAt, '快照月', r.snapshotMonth)
console.log('stats', JSON.stringify(r.stats, null, 1).slice(0, 900))
const sc = r.suspectedClosures ?? []
const byType = {}
for (const x of sc) byType[x.customerType || '未分類'] = (byType[x.customerType || '未分類'] ?? 0) + 1
console.log('疑似歇業', sc.length, byType)
console.log('樣本', sc.slice(0,5).map(x=>[x.customerName, x.customerCity, x.institutionCode, x.customerType]))
