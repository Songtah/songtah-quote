const { computeMonitor } = await import('../lib/medical-monitor-compare.ts')
const r = await computeMonitor()
console.log('hasSnapshot', r.hasSnapshot, '快照月', r.snapshotMonth)
console.log('stats', JSON.stringify(r.stats))
const g = (arr) => { const m={}; for (const x of arr) m[x.customerType||'未分類']=(m[x.customerType||'未分類']??0)+1; return m }
console.log('疑似歇業', r.suspectedClosures.length, g(r.suspectedClosures))
console.log('醫院待確認', r.hospitalUnverified.length)
console.log('代碼待補正', r.invalidCodes.length, '學術', r.academicInstitutions.length)
console.log('歇業樣本', r.suspectedClosures.slice(0,6).map(x=>`${x.customerName}(${x.customerCity}${x.customerDistrict}) ${x.institutionCode} ${x.customerType}`))
