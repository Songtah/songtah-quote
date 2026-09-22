// 業務負荷上限試算：純唯讀，輸出 JSON 到 scratchpad
import fs from 'fs'
const { getAllSystemCustomers } = await import('../lib/notion/customers.ts')
const { listVisits } = await import('../lib/notion/visits.ts')

const OUT = process.argv[2] ?? '/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad/capacity.json'
const FROM = '2026-03-01'   // 觀察期起（避開春節與資料最斷的 1～2 月）
const TO = '2026-08-31'     // 觀察期迄（不含仍在進行的 9 月）

const customers = await getAllSystemCustomers()
const visits = (await listVisits({ dateFrom: FROM, dateTo: TO, fetchAll: true })).items

const custById = new Map(customers.map((c) => [c.id.replace(/-/g, ''), c]))
const activeStatus = (s) => !['停業', '已歇業', '撤銷'].includes(s)

// 持有客戶（負責業務）
const owned = {}
for (const c of customers) {
  if (!c.salesperson) continue
  const o = (owned[c.salesperson] ??= { total: 0, active: 0, byType: {}, ids: new Set() })
  o.total++
  if (activeStatus(c.status)) { o.active++; o.ids.add(c.id.replace(/-/g, '')) }
  o.byType[c.type || '未分類'] = (o.byType[c.type || '未分類'] ?? 0) + 1
}

// 拜訪統計
const sp = {}
for (const v of visits) {
  if (!v.salesperson) continue
  const s = (sp[v.salesperson] ??= {
    records: 0, days: new Set(), months: new Set(),
    custVisits: new Map(),      // customerId → 次數
    unlinked: new Map(),        // 手打名稱 → 次數
    ownVisits: 0, otherVisits: 0,
    byType: {},
  })
  s.records++
  s.days.add(v.date)
  s.months.add(v.date.slice(0, 7))
  const cid = (v.customerId || '').replace(/-/g, '')
  if (cid) {
    s.custVisits.set(cid, (s.custVisits.get(cid) ?? 0) + 1)
    const c = custById.get(cid)
    const t = c?.type || '未分類'
    s.byType[t] = (s.byType[t] ?? 0) + 1
    if (owned[v.salesperson]?.ids.has(cid)) s.ownVisits++; else s.otherVisits++
  } else {
    s.unlinked.set(v.customerName, (s.unlinked.get(v.customerName) ?? 0) + 1)
  }
}

const MONTHS = 6
const result = {}
for (const [name, s] of Object.entries(sp)) {
  const linkedVisits = [...s.custVisits.values()].reduce((a, b) => a + b, 0)
  const uniqueCust = s.custVisits.size
  const uniqueUnlinked = s.unlinked.size
  const workDays = s.days.size
  result[name] = {
    觀察期: `${FROM}～${TO}`,
    拜訪筆數: s.records,
    有客戶關聯: linkedVisits,
    未關聯: s.records - linkedVisits,
    出勤天數: workDays,
    每月平均拜訪筆數: +(s.records / MONTHS).toFixed(1),
    每個出勤日拜訪筆數: +(s.records / Math.max(workDays, 1)).toFixed(2),
    每月平均出勤天數: +(workDays / MONTHS).toFixed(1),
    不重複客戶數_有關聯: uniqueCust,
    不重複名稱_未關聯: uniqueUnlinked,
    不重複合計: uniqueCust + uniqueUnlinked,
    平均每客戶拜訪次數: +((linkedVisits / Math.max(uniqueCust, 1))).toFixed(2),
    實際拜訪週期月: +((MONTHS / Math.max(linkedVisits / Math.max(uniqueCust, 1), 0.01))).toFixed(1),
    持有客戶數: owned[name]?.total ?? 0,
    持有客戶_營業中: owned[name]?.active ?? 0,
    持有客戶類型: owned[name]?.byType ?? {},
    拜訪到的自有客戶比例: owned[name]?.active
      ? +((new Set([...s.custVisits.keys()].filter((id) => owned[name].ids.has(id))).size / owned[name].active) * 100).toFixed(1)
      : null,
    自有客戶拜訪筆數: s.ownVisits,
    非自有客戶拜訪筆數: s.otherVisits,
    拜訪客戶類型分布: s.byType,
  }
}

const totals = {
  客戶總數: customers.length,
  營業中: customers.filter((c) => activeStatus(c.status)).length,
  已指派: customers.filter((c) => c.salesperson).length,
  未指派: customers.filter((c) => !c.salesperson).length,
  客戶類型: customers.reduce((m, c) => ((m[c.type || '未分類'] = (m[c.type || '未分類'] ?? 0) + 1), m), {}),
  拜訪筆數: visits.length,
}
fs.writeFileSync(OUT, JSON.stringify({ totals, bySalesperson: result }, null, 1))
console.log('客戶', customers.length, '拜訪', visits.length, '→', OUT)
for (const [k, v] of Object.entries(result)) {
  console.log(k, '｜月均拜訪', v.每月平均拜訪筆數, '｜出勤天/月', v.每月平均出勤天數, '｜不重複客戶', v.不重複合計,
    '｜週期(月)', v.實際拜訪週期月, '｜持有', v.持有客戶數, '｜覆蓋率', v.拜訪到的自有客戶比例 + '%')
}
