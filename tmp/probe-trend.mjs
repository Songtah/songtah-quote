const { getMonitorKindTrend } = await import('../lib/notion/medical-monitor.ts')
const t = await getMonitorKindTrend(6, { refresh: true })
console.log('查無代碼未歸月存量', t.codeNotFoundStock)
for (const p of t.points) {
  const k = p.kinds
  console.log(p.month, p.baseline ? '(基準月)' : '',
    '診所 +' + k['牙醫診所'].added + '/-' + k['牙醫診所'].removed,
    '｜技工所 +' + k['牙體技術所'].added + '/-' + k['牙體技術所'].removed,
    '｜醫院 +' + k['醫院'].added + '/-' + k['醫院'].removed)
}
