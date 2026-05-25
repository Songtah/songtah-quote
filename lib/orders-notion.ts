import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ORDERS_DB = process.env.NOTION_ORDERS_DB!

function richText(content: string) {
  // Notion rich_text has a 2000 char limit per block — truncate safely
  return [{ text: { content: content.slice(0, 2000) } }]
}

function getText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const type = prop.type
  const val = prop[type]
  if (Array.isArray(val) && val.length > 0) return val.map((b: any) => b.plain_text ?? '').join('')
  return ''
}

function getSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function getDate(page: any, field: string): string {
  return page.properties?.[field]?.date?.start ?? ''
}

function getCreatedTime(page: any, field: string): string {
  return page.properties?.[field]?.created_time ?? ''
}

// ── 台灣時區日期前綴 ──────────────────────────────────────────

function getTWDatePrefix(): string {
  const twNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const yy = String(twNow.getUTCFullYear()).slice(-2)
  const mm = String(twNow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(twNow.getUTCDate()).padStart(2, '0')
  return `PO-${yy}${mm}${dd}`
}

async function generateOrderNumber(): Promise<string> {
  const prefix = getTWDatePrefix()
  const twNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const mm = String(twNow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(twNow.getUTCDate()).padStart(2, '0')
  const todayStart = new Date(
    `${twNow.getUTCFullYear()}-${mm}-${dd}T00:00:00+08:00`
  ).toISOString()

  const resp: any = await notion.databases.query({
    database_id: ORDERS_DB,
    filter: { property: '建立時間', created_time: { on_or_after: todayStart } },
    page_size: 100,
  })

  const todayNums = (resp.results ?? [])
    .map((p: any) => getText(p, '訂單編號'))
    .filter((n: string) => n.startsWith(prefix))

  const maxSeq = todayNums.reduce((max: number, n: string) => {
    const seq = parseInt(n.replace(prefix + '-', ''), 10)
    return isFinite(seq) ? Math.max(max, seq) : max
  }, 0)

  return `${prefix}-${String(maxSeq + 1).padStart(2, '0')}`
}

// ── types ─────────────────────────────────────────────────────

export interface OrderItem {
  id: string          // local UUID, not stored in Notion
  skuCode: string
  skuName: string
  brand: string
  seriesName: string
  seriesId: string
  quantity: number
  unitPrice: number   // 單價（0 = 未填）
  note: string
}

export interface Order {
  id: string
  orderNumber: string
  date: string
  salesperson: string
  status: string
  note: string
  items: OrderItem[]
  totalAmount: number
  createdTime: string
  // 客戶資訊
  customerId: string
  customerName: string
  customerAddress: string
  customerPhone: string
  contactPerson: string
  customerTaxId: string
}

/** 計算訂單總金額 */
export function calcTotal(items: OrderItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * (it.unitPrice || 0), 0)
}

// ── CRUD ──────────────────────────────────────────────────────

export async function listOrders(): Promise<Order[]> {
  const pages: any[] = []
  let cursor: string | undefined

  do {
    const resp: any = await notion.databases.query({
      database_id: ORDERS_DB,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    pages.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)

  return pages.map(parseOrderPage)
}

export async function getOrderById(id: string): Promise<Order | null> {
  const formatted = id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5'
  )
  try {
    const page: any = await notion.pages.retrieve({ page_id: formatted })
    return parseOrderPage(page)
  } catch {
    return null
  }
}

export async function createOrder(data: {
  date: string
  salesperson: string
  note: string
  items: OrderItem[]
  status?: string
  customerId?: string
  customerName?: string
  customerAddress?: string
  customerPhone?: string
  contactPerson?: string
  customerTaxId?: string
}): Promise<Order> {
  const orderNumber = await generateOrderNumber()
  const total = calcTotal(data.items)
  const itemsJson = JSON.stringify(
    data.items.map(({ id: _id, ...rest }) => rest)
  )

  const page: any = await notion.pages.create({
    parent: { database_id: ORDERS_DB },
    properties: {
      訂單編號: { title: richText(orderNumber) },
      日期:     { date: { start: data.date } },
      業務:     { rich_text: richText(data.salesperson) },
      狀態:     { select: { name: data.status ?? '草稿' } },
      備註:     { rich_text: richText(data.note) },
      明細JSON: { rich_text: richText(itemsJson) },
      總金額:   { number: total },
      客戶ID:   { rich_text: richText(data.customerId ?? '') },
      客戶名稱: { rich_text: richText(data.customerName ?? '') },
      地址:     { rich_text: richText(data.customerAddress ?? '') },
      電話:     { rich_text: richText(data.customerPhone ?? '') },
      聯絡人:   { rich_text: richText(data.contactPerson ?? '') },
      統一編號: { rich_text: richText(data.customerTaxId ?? '') },
    },
  })

  return parseOrderPage(page)
}

export async function updateOrderStatus(id: string, status: string): Promise<void> {
  const formatted = id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5'
  )
  await notion.pages.update({
    page_id: formatted,
    properties: { 狀態: { select: { name: status } } },
  })
}

export async function updateOrder(id: string, data: {
  date?: string
  salesperson?: string
  note?: string
  items?: OrderItem[]
  status?: string
  customerId?: string
  customerName?: string
  customerAddress?: string
  customerPhone?: string
  contactPerson?: string
  customerTaxId?: string
}): Promise<void> {
  const formatted = id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5'
  )
  const props: any = {}
  if (data.date)                      props['日期']     = { date: { start: data.date } }
  if (data.salesperson !== undefined) props['業務']     = { rich_text: richText(data.salesperson) }
  if (data.note !== undefined)        props['備註']     = { rich_text: richText(data.note) }
  if (data.status)                    props['狀態']     = { select: { name: data.status } }
  if (data.items) {
    props['明細JSON'] = { rich_text: richText(JSON.stringify(data.items.map(({ id: _id, ...rest }) => rest))) }
    props['總金額']   = { number: calcTotal(data.items) }
  }
  if (data.customerId   !== undefined) props['客戶ID']   = { rich_text: richText(data.customerId) }
  if (data.customerName !== undefined) props['客戶名稱'] = { rich_text: richText(data.customerName) }
  if (data.customerAddress !== undefined) props['地址']  = { rich_text: richText(data.customerAddress) }
  if (data.customerPhone !== undefined)   props['電話']  = { rich_text: richText(data.customerPhone) }
  if (data.contactPerson !== undefined)   props['聯絡人']   = { rich_text: richText(data.contactPerson) }
  if (data.customerTaxId !== undefined)   props['統一編號'] = { rich_text: richText(data.customerTaxId) }

  await notion.pages.update({ page_id: formatted, properties: props })
}

// ── helper ────────────────────────────────────────────────────

function parseOrderPage(page: any): Order {
  const itemsRaw = getText(page, '明細JSON')
  let items: OrderItem[] = []
  try {
    const parsed = JSON.parse(itemsRaw)
    if (Array.isArray(parsed)) {
      items = parsed.map((item: any, idx: number) => ({
        id: `item-${idx}`,
        skuCode: item.skuCode ?? '',
        skuName: item.skuName ?? '',
        brand: item.brand ?? '',
        seriesName: item.seriesName ?? '',
        seriesId: item.seriesId ?? '',
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0,
        note: item.note ?? '',
      }))
    }
  } catch { /* ignore parse errors */ }

  return {
    id: page.id.replace(/-/g, ''),
    orderNumber: getText(page, '訂單編號'),
    date: getDate(page, '日期'),
    salesperson: getText(page, '業務'),
    status: getSelect(page, '狀態'),
    note: getText(page, '備註'),
    items,
    totalAmount: page.properties?.['總金額']?.number ?? 0,
    createdTime: getCreatedTime(page, '建立時間'),
    customerId: getText(page, '客戶ID'),
    customerName: getText(page, '客戶名稱'),
    customerAddress: getText(page, '地址'),
    customerPhone: getText(page, '電話'),
    contactPerson: getText(page, '聯絡人'),
    customerTaxId: getText(page, '統一編號'),
  }
}
