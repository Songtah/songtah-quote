import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const customersDb = process.env.NOTION_CUSTOMERS_SYSTEM_DB || process.env.NOTION_CUSTOMERS_DB
const visitsDb = process.env.NOTION_VISITS_DB

if (!customersDb || !visitsDb) throw new Error('缺少客戶主檔或客情資料庫設定')

async function queryAll(databaseId, query) {
  const rows = []
  let cursor
  do {
    const response = await notion.databases.query({
      database_id: databaseId.replace('collection://', ''),
      page_size: 100,
      ...query,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    rows.push(...response.results)
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)
  return rows
}

const text = (property) => property?.title?.map((item) => item.plain_text).join('') || ''
const selected = (property) => property?.select?.name || ''

async function findCandidates() {
  const [customers, followUps] = await Promise.all([
    queryAll(customersDb, { filter: { property: '開發階段', select: { is_not_empty: true } } }),
    queryAll(visitsDb, {
      filter: { and: [
        { property: '是否需追蹤', checkbox: { equals: true } },
        { property: '追蹤已結案', checkbox: { equals: false } },
      ] },
    }),
  ])
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const followUpByCustomer = new Map()
  for (const visit of followUps) {
    const customerId = visit.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id
    if (!customerId) continue
    const current = followUpByCustomer.get(customerId) || { count: 0, nextDate: '' }
    const nextDate = visit.properties?.['下次追蹤日']?.date?.start || ''
    current.count += 1
    if (nextDate && (!current.nextDate || nextDate < current.nextDate)) current.nextDate = nextDate
    followUpByCustomer.set(customerId, current)
  }
  return customers.flatMap((customer) => {
    const stage = selected(customer.properties?.['開發階段'])
    const owner = selected(customer.properties?.['負責業務'])
    const followUp = followUpByCustomer.get(customer.id) || { count: 0, nextDate: '' }
    const reasons = [
      ...(followUp.nextDate && followUp.nextDate < today ? ['逾期追蹤'] : []),
      ...(stage === '線索' && !owner ? ['未認領線索'] : []),
    ]
    return reasons.length ? [{
      id: customer.id,
      name: text(customer.properties?.['客戶名稱']),
      stage,
      source: selected(customer.properties?.['開發來源']),
      owner,
      nextFollowUpDate: followUp.nextDate,
      openFollowUps: followUp.count,
      reasons,
    }] : []
  })
}

const rows = await findCandidates()
console.log(JSON.stringify({
  mode: process.argv.includes('--execute') ? 'execute' : 'dry-run',
  affected: rows.length,
  sample: rows.slice(0, 20),
}, null, 2))

if (process.argv.includes('--execute')) {
  for (const [index, row] of rows.entries()) {
    await notion.pages.update({
      page_id: row.id,
      properties: {
        '開發階段': { select: null },
        '開發來源': { select: null },
      },
    })
    console.log(`cleared ${index + 1}/${rows.length}: ${row.id}`)
  }
}
