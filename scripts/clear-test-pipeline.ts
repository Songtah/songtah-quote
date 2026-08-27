import { listPipelineCustomers, updateCustomerDevStage } from '../lib/notion/customers'
import { listOpenFollowUps } from '../lib/notion/visits'

type Candidate = Awaited<ReturnType<typeof listPipelineCustomers>>[number] & {
  openFollowUps: number
  nextFollowUpDate: string
  reasons: string[]
}

function businessDateTW(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

async function candidates(): Promise<Candidate[]> {
  const [customers, followUps] = await Promise.all([
    listPipelineCustomers(),
    listOpenFollowUps(),
  ])
  const followUpByCustomer = new Map<string, { count: number; nextDate: string }>()
  for (const visit of followUps) {
    if (!visit.customerId) continue
    const current = followUpByCustomer.get(visit.customerId) ?? { count: 0, nextDate: '' }
    current.count += 1
    if (visit.nextFollowUpDate && (!current.nextDate || visit.nextFollowUpDate < current.nextDate)) {
      current.nextDate = visit.nextFollowUpDate
    }
    followUpByCustomer.set(visit.customerId, current)
  }

  const today = businessDateTW()
  return customers.flatMap((customer) => {
    const followUp = followUpByCustomer.get(customer.id) ?? { count: 0, nextDate: '' }
    const reasons = [
      ...(followUp.nextDate && followUp.nextDate < today ? ['逾期追蹤'] : []),
      ...(customer.devStage === '線索' && !customer.salesperson ? ['未認領線索'] : []),
    ]
    return reasons.length ? [{ ...customer, openFollowUps: followUp.count, nextFollowUpDate: followUp.nextDate, reasons }] : []
  })
}

async function main() {
  const execute = process.argv.includes('--execute')
  const rows = await candidates()
  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    affected: rows.length,
    sample: rows.slice(0, 20).map((row) => ({
      id: row.id,
      name: row.name,
      devStage: row.devStage,
      devSource: row.devSource,
      salesperson: row.salesperson || '(未認領)',
      nextFollowUpDate: row.nextFollowUpDate || '(無)',
      openFollowUps: row.openFollowUps,
      reasons: row.reasons,
    })),
  }, null, 2))

  if (!execute) return
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    await updateCustomerDevStage(row.id, { devStage: null })
    console.log(`cleared ${index + 1}/${rows.length}: ${row.id}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
