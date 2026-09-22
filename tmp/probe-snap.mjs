import { readFileSync } from 'fs'
const snap = JSON.parse(readFileSync('data/clinic-snapshot.json','utf8'))
const LAB = new Set(['牙體技術所','鑲牙所'])
const CLINIC = new Set(['牙醫診所','衛生所','診所'])
const c = {}
for (const [code, e] of Object.entries(snap.codes ?? {})) {
  const k = e.kind || '(空)'
  c[k] = (c[k] ?? 0) + 1
}
console.log('快照 codes 各 kind 筆數', c, '合計', Object.values(c).reduce((a,b)=>a+b,0))
console.log('快照宣告的總數 totalClinics', snap.totalClinics, 'totalLabs', snap.totalLabs, 'totalHospitals', snap.totalHospitals)
