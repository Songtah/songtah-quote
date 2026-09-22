const { listVisits, updateVisit, deleteVisit } = await import('../lib/notion/visits.ts')
const { searchSystemCustomers } = await import('../lib/notion/customers.ts')
const { customerNameStem, pickUniqueCustomerMatch } = await import('../lib/customer-name-match.ts')
const APPLY = process.argv.includes('--apply')

const r = await listVisits({ fetchAll: true })
const dot = r.items.filter(v => /^[.。．、,，·•\s]/.test(v.customerName))
const yu = r.items.filter(v => v.customerName.startsWith('與'))
console.log(`${APPLY ? '執行' : '預演'}：去符號 ${dot.length} 筆、封存 ${yu.length} 筆`)

for (const v of dot) {
  const name = v.customerName.replace(/^[.。．、,，·•:：\-\s]+/, '').trim()
  let matched = null
  if (!v.customerId) {
    let ms = await searchSystemCustomers(name)
    const stem = customerNameStem(name)
    if (ms.length === 0 && stem && stem !== name) ms = await searchSystemCustomers(stem)
    matched = pickUniqueCustomerMatch(name, ms)
    // 只接受「主檔名稱以手打名稱開頭」的配對：實測「新生」會比中「喜樂新生牙醫診所」，不是同一家
    if (matched && !matched.name.startsWith(name)) matched = null
  }
  console.log(`改名 ${v.date} ${v.salesperson} 「${v.customerName}」→「${name}」${v.customerId ? '（已有配對）' : matched ? ` 配對→ ${matched.name}` : ' 仍配不到'}`)
  if (APPLY) await updateVisit(v.id, matched ? { customerName: name, customerId: matched.id } : { customerName: name })
}
for (const v of yu) {
  console.log(`封存 ${v.date} ${v.salesperson} 「${v.customerName.slice(0, 40)}」`)
  if (APPLY) await deleteVisit(v.id)
}
console.log('完成')
