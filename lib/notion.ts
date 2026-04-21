import { Client } from '@notionhq/client'
import type { Product, Customer, Quote, QuoteItem } from '@/types'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const DB = {
  products:  process.env.NOTION_PRODUCTS_DB!,
  customers: process.env.NOTION_CUSTOMERS_DB!,
  quotes:    process.env.NOTION_QUOTES_DB!,
  items:     process.env.NOTION_ITEMS_DB!,
}

// ── helpers ──────────────────────────────────────────────────

function getText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const type = prop.type
  const val = prop[type]
  if (Array.isArray(val) && val.length > 0) return val[0].plain_text ?? ''
  if (type === 'url' && val) return val
  return ''
}

function getNumber(page: any, field: string): number | null {
  return page.properties?.[field]?.number ?? null
}

function getSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function getCheckbox(page: any, field: string): boolean {
  return page.properties?.[field]?.checkbox ?? false
}

function getDate(page: any, field: string): string {
  return page.properties?.[field]?.date?.start ?? ''
}

function getUniqueId(page: any, field: string): number {
  return page.properties?.[field]?.unique_id?.number ?? 0
}

function getCreatedTime(page: any, field: string): string {
  return page.properties?.[field]?.created_time ?? ''
}

function getFileUrl(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  if (prop.type === 'files') {
    const files: any[] = prop.files ?? []
    if (files.length === 0) return ''
    const f = files[0]
    return f.type === 'external' ? (f.external?.url ?? '') : (f.file?.url ?? '')
  }
  if (prop.type === 'url') return prop.url ?? ''
  return ''
}

function richText(content: string) {
  return [{ text: { content } }]
}

// 讀取報價單號（新格式優先，舊格式回退）
function getQuoteNumber(page: any): string {
  const custom = getText(page, '編號')
  if (custom) return custom
  const uid = getUniqueId(page, '報價單號')
  return uid ? `QT-${String(uid).padStart(4, '0')}` : '—'
}

// 確保 Notion DB 欄位存在（每個 process 只執行一次）
let _fieldsEnsured = false
async function ensureDbFields() {
  if (_fieldsEnsured) return
  try {
    await Promise.all([
      notion.databases.update({
        database_id: DB.quotes,
        properties: {
          '編號': { rich_text: {} },
          '電話': { rich_text: {} },
          '地址': { rich_text: {} },
          '統一編號': { rich_text: {} },
        } as any,
      }),
      notion.databases.update({
        database_id: DB.items,
        properties: { '圖片URL': { url: {} } } as any,
      }),
    ])
  } catch (e) {
    console.warn('ensureDbFields warning:', e)
  }
  _fieldsEnsured = true
}

function formatQuoteDatePrefix(date: Date): string {
  const yyyy = String(date.getUTCFullYear())
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy.slice(-2)}${mm}${dd}`
}

// 生成日期序列編號 YYMMDD##（台灣時間 UTC+8）
async function generateQuoteNumber(): Promise<string> {
  const twNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const mm = String(twNow.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(twNow.getUTCDate()).padStart(2, '0')
  const prefix = formatQuoteDatePrefix(twNow)
  const todayStart = new Date(
    `${twNow.getUTCFullYear()}-${mm}-${dd}T00:00:00+08:00`
  ).toISOString()

  const resp: any = await notion.databases.query({
    database_id: DB.quotes,
    filter: { property: '建立時間', created_time: { on_or_after: todayStart } },
    page_size: 100,
  })
  const todaysNumbers = (resp.results ?? [])
    .map((page: any) => getQuoteNumber(page))
    .filter((number: string) => number.startsWith(prefix))

  const maxSeq = todaysNumbers.reduce((max: number, number: string) => {
    const seq = Number(number.slice(prefix.length))
    return Number.isFinite(seq) ? Math.max(max, seq) : max
  }, 0)

  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`
}

// ── products ─────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const pages: any[] = []
  let cursor: string | undefined

  do {
    const resp: any = await notion.databases.query({
      database_id: DB.products,
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    pages.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)

  return pages.map((p) => {
    // Title field is 'Name' in this DB
    let name = ''
    for (const val of Object.values(p.properties ?? {}) as any[]) {
      if (val.type === 'title') {
        name = val.title?.map((t: any) => t.plain_text).join('') ?? ''
        break
      }
    }
    return {
      id:       p.id,
      name,
      brand:    getSelect(p, '生產商'),
      category: getSelect(p, '分類'),
      spec:     getSelect(p, '商品類型'),
      unit:     '個',
      price:    getNumber(p, '價格'),
      series:   '',
      active:   true,
      imageUrl: '',
    }
  })
}

// ── customers ────────────────────────────────────────────────

export async function searchCustomers(query: string): Promise<Customer[]> {
  if (!query || query.trim().length < 1) return []

  const resp: any = await notion.databases.query({
    database_id: DB.customers,
    filter: {
      and: [
        { property: '客戶名稱', title: { contains: query.trim() } },
        { property: '機構狀態', select: { does_not_equal: '已歇業' } },
      ],
    },
    sorts: [{ property: '客戶名稱', direction: 'ascending' }],
    page_size: 20,
  })

  return resp.results.map((p: any) => ({
    id:      p.id,
    name:    getText(p, '客戶名稱'),
    address: getText(p, '地址'),
    phone:   p.properties?.['電話']?.phone_number ?? '',
    taxId:   getText(p, '統一編號'),
    city:    getSelect(p, '縣市'),
    type:    getSelect(p, '客戶類型'),
    status:  getSelect(p, '機構狀態'),
  }))
}

// ── quotes ───────────────────────────────────────────────────

export async function createQuote(data: {
  customerName: string
  customerId: string
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  validUntil: string
  paymentTerms: string
  note: string
  total: number
  items: QuoteItem[]
  appUrl: string
}): Promise<Quote> {
  await ensureDbFields()

  const quoteNumber = await generateQuoteNumber()

  // 1. 建立報價單頁面
  const quotePage: any = await notion.pages.create({
    parent: { database_id: DB.quotes },
    properties: {
      Name:         { title: richText(quoteNumber) },
      編號:         { rich_text: richText(quoteNumber) },
      客戶名稱:     { rich_text: richText(data.customerName) },
      客戶ID:       { rich_text: richText(data.customerId) },
      電話:         { rich_text: richText(data.customerPhone) },
      地址:         { rich_text: richText(data.customerAddress) },
      統一編號:     { rich_text: richText(data.customerTaxId) },
      業務姓名:     { rich_text: richText(data.salesperson) },
      付款條件:     { rich_text: richText(data.paymentTerms) },
      備註:         { rich_text: richText(data.note) },
      總金額:       { number: data.total },
      狀態:         { select: { name: '已送出' } },
      ...(data.validUntil ? { 有效期限: { date: { start: data.validUntil } } } : {}),
    },
  })

  const quoteId = quotePage.id
  const shareUrl = `${data.appUrl}/share/${quoteId.replace(/-/g, '')}`

  // 2. 更新分享連結
  await notion.pages.update({
    page_id: quoteId,
    properties: { 分享連結: { url: shareUrl } },
  })

  // 3. 建立報價明細
  await Promise.all(
    data.items.map((item) =>
      notion.pages.create({
        parent: { database_id: DB.items },
        properties: {
          品名:   { title: richText(item.name) },
          報價單: { relation: [{ id: quoteId }] },
          品牌:   { rich_text: richText(item.brand) },
          品類:   { rich_text: richText(item.category) },
          規格:   { rich_text: richText(item.spec) },
          單位:   { rich_text: richText(item.unit) },
          單價:   { number: item.unitPrice },
          數量:   { number: item.quantity },
          備註:   { rich_text: richText(item.note) },
          ...(item.imageUrl ? { 圖片URL: { url: item.imageUrl } } : {}),
          ...(item.isCustom ? { 品牌: { rich_text: richText(item.brand || '客製化') } } : {}),
        },
      })
    )
  )

  return {
    id:           quoteId,
    quoteNumber,
    customerName: data.customerName,
    customerId:   data.customerId,
    customerPhone: data.customerPhone,
    customerAddress: data.customerAddress,
    customerTaxId: data.customerTaxId,
    salesperson:  data.salesperson,
    validUntil:   data.validUntil,
    paymentTerms: data.paymentTerms,
    total:        data.total,
    status:       '已送出',
    shareUrl,
    note:         data.note,
    createdAt:    new Date().toISOString(),
    items:        data.items,
  }
}

export async function listQuotes(): Promise<Quote[]> {
  const resp: any = await notion.databases.query({
    database_id: DB.quotes,
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: 100,
  })

  return resp.results
    .filter((p: any) => !p.archived)
    .map((p: any) => ({
      id:           p.id,
      quoteNumber:  getQuoteNumber(p),
      customerName: getText(p, '客戶名稱'),
      customerId:   getText(p, '客戶ID'),
      customerPhone: getText(p, '電話'),
      customerAddress: getText(p, '地址'),
      customerTaxId: getText(p, '統一編號'),
      salesperson:  getText(p, '業務姓名'),
      validUntil:   getDate(p, '有效期限'),
      paymentTerms: getText(p, '付款條件'),
      total:        getNumber(p, '總金額') ?? 0,
      status:       (getSelect(p, '狀態') || '草稿') as Quote['status'],
      shareUrl:     getText(p, '分享連結'),
      note:         getText(p, '備註'),
      createdAt:    getCreatedTime(p, '建立時間'),
    }))
}

export async function getQuote(pageId: string): Promise<Quote | null> {
  try {
    const formatted = pageId.replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      '$1-$2-$3-$4-$5'
    )
    const page: any = await notion.pages.retrieve({ page_id: formatted })

    const itemsResp: any = await notion.databases.query({
      database_id: DB.items,
      filter: { property: '報價單', relation: { contains: formatted } },
    })

    const items: QuoteItem[] = itemsResp.results.map((p: any) => {
      const unitPrice = getNumber(p, '單價') ?? 0
      const quantity  = getNumber(p, '數量') ?? 0
      return {
        productId: '',
        name:      getText(p, '品名'),
        brand:     getText(p, '品牌'),
        category:  getText(p, '品類'),
        spec:      getText(p, '規格'),
        unit:      getText(p, '單位'),
        unitPrice,
        quantity,
        subtotal:  unitPrice * quantity,
        note:      getText(p, '備註'),
        imageUrl:  p.properties?.['圖片URL']?.url ?? '',
        isCustom:  getText(p, '品牌') === '客製化',
      }
    })

    return {
      id:           page.id,
      quoteNumber:  getQuoteNumber(page),
      customerName: getText(page, '客戶名稱'),
      customerId:   getText(page, '客戶ID'),
      customerPhone: getText(page, '電話'),
      customerAddress: getText(page, '地址'),
      customerTaxId: getText(page, '統一編號'),
      salesperson:  getText(page, '業務姓名'),
      validUntil:   getDate(page, '有效期限'),
      paymentTerms: getText(page, '付款條件'),
      total:        getNumber(page, '總金額') ?? 0,
      status:       (getSelect(page, '狀態') || '草稿') as Quote['status'],
      shareUrl:     getText(page, '分享連結'),
      note:         getText(page, '備註'),
      createdAt:    getCreatedTime(page, '建立時間'),
      items,
    }
  } catch {
    return null
  }
}

export async function deleteQuote(pageId: string): Promise<void> {
  const formatted = pageId.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5'
  )

  // 先刪除所有明細
  const itemsResp: any = await notion.databases.query({
    database_id: DB.items,
    filter: { property: '報價單', relation: { contains: formatted } },
  })
  await Promise.all(
    itemsResp.results.map((p: any) =>
      notion.pages.update({ page_id: p.id, archived: true })
    )
  )

  // 再刪除報價單本體
  await notion.pages.update({ page_id: formatted, archived: true })
}
