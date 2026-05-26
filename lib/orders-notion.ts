import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ORDERS_DB      = process.env.NOTION_ORDERS_DB!
const ORDER_ITEMS_DB = process.env.NOTION_ORDER_ITEMS_DB!

function richText(content: string) {
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

/** 32-char hex → UUID with hyphens */
function formatId(id: string): string {
  return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
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
  const twNow  = new Date(Date.now() + 8 * 60 * 60 * 1000)
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

// ── Types ─────────────────────────────────────────────────────

export interface OrderItem {
  id: string          // local UUID, not stored in Notion
  skuCode: string
  skuName: string
  brand: string
  seriesName: string
  seriesId: string
  quantity: number
  unitPrice: number
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
  customerId: string
  customerName: string
  companyTitle?: string
  customerAddress: string
  customerPhone: string
  contactPerson: string
  customerTaxId: string
}

export function calcTotal(items: OrderItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * (it.unitPrice || 0), 0)
}

// ── Item helpers ───────────────────────────────────────────────

function parseItemPage(page: any): OrderItem & { orderId: string } {
  const relations: any[] = page.properties?.['訂購單']?.relation ?? []
  const orderId = (relations[0]?.id ?? '').replace(/-/g, '')
  return {
    id:         `item-${page.id}`,
    skuCode:    getText(page, '貨品碼'),
    skuName:    getText(page, '品名'),
    brand:      getText(page, '品牌'),
    seriesName: getText(page, '系列'),
    seriesId:   '',
    quantity:   page.properties?.['數量']?.number ?? 1,
    unitPrice:  page.properties?.['單價']?.number ?? 0,
    note:       getText(page, '備註'),
    orderId,
  }
}

/** Fetch ALL items across all orders (two API calls: orders list + all items) */
async function getAllOrderItems(): Promise<Array<OrderItem & { orderId: string }>> {
  if (!ORDER_ITEMS_DB) return []
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: ORDER_ITEMS_DB,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results.map(parseItemPage)
}

/** Fetch items for a single order (UUID format) */
async function getItemsByOrderId(formattedId: string): Promise<OrderItem[]> {
  if (!ORDER_ITEMS_DB) return []
  const resp: any = await notion.databases.query({
    database_id: ORDER_ITEMS_DB,
    filter: { property: '訂購單', relation: { contains: formattedId } },
    page_size: 100,
  })
  return (resp.results ?? []).map((p: any) => {
    const { orderId: _oid, ...item } = parseItemPage(p)
    return item
  })
}

/** Create item pages in 訂購明細, linked to the order */
async function createOrderItems(orderId: string, items: OrderItem[]): Promise<void> {
  if (items.length === 0) return
  if (!ORDER_ITEMS_DB) throw new Error('NOTION_ORDER_ITEMS_DB 環境變數未設定，訂購明細無法儲存')
  await Promise.all(
    items.map((item) =>
      notion.pages.create({
        parent: { database_id: ORDER_ITEMS_DB },
        properties: {
          品名:   { title: richText(item.skuName) },
          貨品碼: { rich_text: richText(item.skuCode) },
          品牌:   { rich_text: richText(item.brand) },
          系列:   { rich_text: richText(item.seriesName) },
          數量:   { number: item.quantity },
          單價:   { number: item.unitPrice },
          備註:   { rich_text: richText(item.note ?? '') },
          訂購單: { relation: [{ id: orderId }] },
        },
      })
    )
  )
}

/** Archive (soft-delete) all item pages for an order */
async function deleteOrderItems(formattedId: string): Promise<void> {
  if (!ORDER_ITEMS_DB) return
  const resp: any = await notion.databases.query({
    database_id: ORDER_ITEMS_DB,
    filter: { property: '訂購單', relation: { contains: formattedId } },
    page_size: 100,
  })
  await Promise.all(
    (resp.results ?? []).map((p: any) =>
      notion.pages.update({ page_id: p.id, archived: true })
    )
  )
}

// ── Parse order page ───────────────────────────────────────────

function parseOrderPage(page: any, items: OrderItem[] = []): Order {
  return {
    id:           page.id.replace(/-/g, ''),
    orderNumber:  getText(page, '訂單編號'),
    date:         getDate(page, '日期'),
    salesperson:  getText(page, '業務'),
    status:       getSelect(page, '狀態'),
    note:         getText(page, '備註'),
    items,
    totalAmount:  page.properties?.['總金額']?.number ?? 0,
    createdTime:  getCreatedTime(page, '建立時間'),
    customerId:   getText(page, '客戶ID'),
    customerName: getText(page, '客戶名稱'),
    companyTitle: getText(page, '公司抬頭'),
    customerAddress: getText(page, '地址'),
    customerPhone:   getText(page, '電話'),
    contactPerson:   getText(page, '聯絡人'),
    customerTaxId:   getText(page, '統一編號'),
  }
}

// ── CRUD ──────────────────────────────────────────────────────

export async function listOrders(): Promise<Order[]> {
  // Fetch orders and all items in parallel
  const orderPagesPromise = (async () => {
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
    return pages
  })()

  const [orderPages, allItems] = await Promise.all([orderPagesPromise, getAllOrderItems()])

  // Group items by order ID
  const itemsByOrder: Record<string, OrderItem[]> = {}
  for (const { orderId, ...item } of allItems) {
    if (!itemsByOrder[orderId]) itemsByOrder[orderId] = []
    itemsByOrder[orderId].push(item)
  }

  return orderPages.map((page) => {
    const orderId = page.id.replace(/-/g, '')
    return parseOrderPage(page, itemsByOrder[orderId] ?? [])
  })
}

export async function getOrderById(id: string): Promise<Order | null> {
  const formatted = formatId(id)
  try {
    const [page, items] = await Promise.all([
      notion.pages.retrieve({ page_id: formatted }),
      getItemsByOrderId(formatted),
    ])
    return parseOrderPage(page as any, items)
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
  companyTitle?: string
  customerAddress?: string
  customerPhone?: string
  contactPerson?: string
  customerTaxId?: string
}): Promise<Order> {
  const orderNumber = await generateOrderNumber()
  const total = calcTotal(data.items)

  const page: any = await notion.pages.create({
    parent: { database_id: ORDERS_DB },
    properties: {
      訂單編號: { title: richText(orderNumber) },
      日期:     { date: { start: data.date } },
      業務:     { rich_text: richText(data.salesperson) },
      狀態:     { select: { name: data.status ?? '草稿' } },
      備註:     { rich_text: richText(data.note) },
      總金額:   { number: total },
      客戶ID:   { rich_text: richText(data.customerId ?? '') },
      客戶名稱: { rich_text: richText(data.customerName ?? '') },
      公司抬頭: { rich_text: richText(data.companyTitle ?? '') },
      地址:     { rich_text: richText(data.customerAddress ?? '') },
      電話:     { rich_text: richText(data.customerPhone ?? '') },
      聯絡人:   { rich_text: richText(data.contactPerson ?? '') },
      統一編號: { rich_text: richText(data.customerTaxId ?? '') },
    },
  })

  // Create item pages in 訂購明細, linked to this order
  await createOrderItems(page.id, data.items)

  return parseOrderPage(page, data.items.map((item, idx) => ({ ...item, id: `item-${idx}` })))
}

export async function archiveOrder(id: string): Promise<void> {
  const formatted = formatId(id)
  // Archive item pages first, then the order
  await deleteOrderItems(formatted)
  await notion.pages.update({ page_id: formatted, archived: true })
}

export async function updateOrderStatus(id: string, status: string): Promise<void> {
  await notion.pages.update({
    page_id: formatId(id),
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
  companyTitle?: string
  customerAddress?: string
  customerPhone?: string
  contactPerson?: string
  customerTaxId?: string
}): Promise<void> {
  const formatted = formatId(id)
  const props: any = {}

  if (data.date)                           props['日期']     = { date: { start: data.date } }
  if (data.salesperson !== undefined)      props['業務']     = { rich_text: richText(data.salesperson) }
  if (data.note !== undefined)             props['備註']     = { rich_text: richText(data.note) }
  if (data.status)                         props['狀態']     = { select: { name: data.status } }
  if (data.customerId   !== undefined)     props['客戶ID']   = { rich_text: richText(data.customerId) }
  if (data.customerName !== undefined)     props['客戶名稱'] = { rich_text: richText(data.customerName) }
  if (data.companyTitle !== undefined)     props['公司抬頭'] = { rich_text: richText(data.companyTitle) }
  if (data.customerAddress !== undefined)  props['地址']     = { rich_text: richText(data.customerAddress) }
  if (data.customerPhone !== undefined)    props['電話']     = { rich_text: richText(data.customerPhone) }
  if (data.contactPerson !== undefined)    props['聯絡人']   = { rich_text: richText(data.contactPerson) }
  if (data.customerTaxId !== undefined)    props['統一編號'] = { rich_text: richText(data.customerTaxId) }

  if (data.items) {
    // Replace all item pages
    await deleteOrderItems(formatted)
    await createOrderItems(formatted, data.items)
    props['總金額'] = { number: calcTotal(data.items) }
  }

  if (Object.keys(props).length > 0) {
    await notion.pages.update({ page_id: formatted, properties: props })
  }
}
