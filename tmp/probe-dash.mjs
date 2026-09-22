const { computeMonitor } = await import('../lib/medical-monitor-compare.ts')
const { getMonitorHistory } = await import('../lib/notion/medical-monitor.ts')
await computeMonitor()
const h = (await getMonitorHistory())[0]
console.log('月份', h.month)
const row = (label, total, all, inBas) =>
  console.log(`${label.padEnd(6)} 全台 ${String(total).padStart(6)} ｜客戶(在BAS) ${String(inBas ?? '-').padStart(6)} ｜客戶(全部) ${String(all).padStart(6)} ｜差 ${all - (inBas ?? 0)}`)
row('診所', h.totalClinics, h.custClinics, h.custClinicsInBas)
row('技工所', h.totalLabs, h.custLabs, h.custLabsInBas)
row('醫院', h.totalHospitals, h.custHospitals, h.custHospitalsInBas)
row('學校', h.totalSchools, h.custSchools, undefined)
