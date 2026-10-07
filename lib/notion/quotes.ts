/**
 * lib/notion/quotes.ts — 報價單（葉領域，2026-10-07 自 lib/notion.ts 抽出並擴充）
 *
 * 報價單 DB（NOTION_QUOTES_DB）＋報價明細 DB（NOTION_ITEMS_DB，以「報價單」relation 掛回）。
 *
 * 2026-10-07 依紙本報價單整合：
 *   - 新欄位：公司抬頭、聯絡人、報價日期、稅別、折讓、交貨條件、版面設定；明細加「序號」保順序
 *     （原本程式寫入「公司抬頭」但 DB 沒有這個欄位，Notion 會拒絕整筆建立）
 *   - 補欄位只補「不存在」的，既有欄位的型別一律不動
 *   - 可修改：草稿／待行政審核／已退回（已核准後價格定格，見 lib/quote-status.ts）
 *   - 金額由伺服器依 lib/quote-model 重算，不採信前端
 */
import type { Quote, QuoteItem } from '@/types'
import { notion, notionCallWithRetry, getText, getTitle, getSelect, getDate } from './shared'
import { computeQuoteTotals, lineAmount, todayTW, type TaxMode } from '@/lib/quote-model'

const QUOTES_DB = () => process.env.NOTION_QUOTES_DB!
const ITEMS_DB = () => process.env.NOTION_ITEMS_DB!

const toUuid = (id: string) => id.replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')

/** Notion 單段 rich_text 上限 2,000 字；長備註切段寫入，讀取時 getText 會串回 */
function longText(content: string) {
  const s = content ?? ''
  if (!s) return []
  const out = []
  for (let i = 0; i < s.length; i += 1900) out.push({ type: 'text', text: { content: s.slice(i, i + 1900) } })
  return out
}

const num = (page: any, field: string): number | null => page.properties?.[field]?.number ?? null

// ── 欄位補齊（每個 process 一次；只補缺的，不改既有欄位型別）──────────────────
let ensured: Promise<void> | null = null
function ensureSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const want: Record<string, Record<string, any>> = {
        [QUOTES_DB()]: {
          '編號': { rich_text: {} }, '電話': { rich_text: {} }, '地址': { rich_text: {} },
          '統一編號': { rich_text: {} }, '審核意見': { rich_text: {} },
          '公司抬頭': { rich_text: {} }, '聯絡人': { rich_text: {} }, '報價日期': { date: {} },
          '稅別': { select: { options: [{ name: '含稅', color: 'green' }, { name: '未稅', color: 'gray' }] } },
          '折讓': { number: { format: 'number' } }, '交貨條件': { rich_text: {} }, '版面設定': { rich_text: {} },
        },
        [ITEMS_DB()]: { '圖片URL': { url: {} }, '序號': { number: { format: 'number' } } },
      }
      for (const [dbId, props] of Object.entries(want)) {
        const db: any = await notionCallWithRetry('quotes:schema', () => notion.databases.retrieve({ database_id: dbId }))
        const missing = Object.fromEntries(Object.entries(props).filter(([k]) => !db.properties?.[k]))
        if (Object.keys(missing).length) {
          await notionCallWithRetry('quotes:schema:add', () => notion.databases.update({ database_id: dbId, properties: missing as any }))
          console.info(`[quotes] 補上欄位：${Object.keys(missing).join('、')}`)
        }
      }
    })().catch((e) => { ensured = null; throw e })
  }
  return ensured
}

// ── 讀取 ─────────────────────────────────────────────────────────────────────
function quoteNumberOf(page: any): string {
  const custom = getText(page, '編號')
  if (custom) return custom
  const uid = page.properties?.['報價單號']?.unique_id?.number ?? 0
  return uid ? `QT-${String(uid).padStart(4, '0')}` : '—'
}

function mapQuote(page: any, items?: QuoteItem[]): Quote {
  const createdAt = page.properties?.['建立時間']?.created_time ?? page.created_time ?? ''
  return {
    id:              page.id,
    quoteNumber:     quoteNumberOf(page),
    customerName:    getText(page, '客戶名稱'),
    customerId:      getText(page, '客戶ID'),
    companyTitle:    getText(page, '公司抬頭'),
    contactPerson:   getText(page, '聯絡人'),
    customerPhone:   getText(page, '電話'),
    customerAddress: getText(page, '地址'),
    customerTaxId:   getText(page, '統一編號'),
    salesperson:     getText(page, '業務姓名'),
    quoteDate:       getDate(page, '報價日期') || (createdAt ? new Date(new Date(createdAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10) : ''),
    validUntil:      getDate(page, '有效期限'),
    paymentTerms:    getText(page, '付款條件'),
    deliveryTerms:   getText(page, '交貨條件'),
    taxMode:         (getSelect(page, '稅別') || '含稅') as TaxMode,
    discount:        num(page, '折讓') ?? 0,
    layout:          getText(page, '版面設定'),
    total:           num(page, '總金額') ?? 0,
    status:          (getSelect(page, '狀態') || '草稿') as Quote['status'],
    shareUrl:        page.properties?.['分享連結']?.url ?? '',
    note:            getText(page, '備註'),
    approvalNote:    getText(page, '審核意見'),
    createdAt,
    ...(items ? { items } : {}),
  }
}

function mapItem(p: any): QuoteItem & { seq: number } {
  const unitPrice = num(p, '單價') ?? 0
  const quantity = num(p, '數量') ?? 0
  const brand = getText(p, '品牌')
  return {
    seq:       num(p, '序號') ?? Number.MAX_SAFE_INTEGER,
    productId: '',
    name:      getTitle(p, '品名'),
    brand:     brand === '客製化' ? '' : brand,
    category:  getText(p, '品類'),
    spec:      getText(p, '規格'),
    unit:      getText(p, '單位'),
    unitPrice,
    quantity,
    subtotal:  lineAmount(unitPrice, quantity),
    note:      getText(p, '備註'),
    imageUrl:  p.properties?.['圖片URL']?.url ?? '',
    isCustom:  brand === '客製化',
  }
}

async function listItemPages(quoteId: string): Promise<any[]> {
  const pages: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('quotes:items', () => notion.databases.query({
      database_id: ITEMS_DB(),
      filter: { property: '報價單', relation: { contains: toUuid(quoteId) } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    }))
    pages.push(...(res.results ?? []))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return pages
}

export async function getQuote(pageId: string): Promise<Quote | null> {
  try {
    const page: any = await notion.pages.retrieve({ page_id: toUuid(pageId) })
    if (page.archived) return null
    const itemPages = await listItemPages(pageId)
    // 依序號排（2026-10-07 前建立的明細沒有序號，維持建立時間順序）
    const items = itemPages
      .map((p) => ({ ...mapItem(p), created: p.created_time as string }))
      .sort((a, b) => a.seq - b.seq || a.created.localeCompare(b.created))
      .map(({ seq, created, ...rest }) => rest)
    return mapQuote(page, items)
  } catch {
    return null
  }
}

export async function listQuotes(options?: { limit?: number; cursor?: string; salesperson?: string }):
  Promise<{ items: Quote[]; hasMore: boolean; nextCursor: string | null }> {
  const resp: any = await notion.databases.query({
    database_id: QUOTES_DB(),
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: options?.limit ?? 10,
    ...(options?.salesperson ? { filter: { property: '業務姓名', rich_text: { equals: options.salesperson } } } : {}),
    ...(options?.cursor ? { start_cursor: options.cursor } : {}),
  })
  return {
    items: resp.results.filter((p: any) => !p.archived).map((p: any) => mapQuote(p)),
    hasMore: resp.has_more ?? false,
    nextCursor: resp.next_cursor ?? null,
  }
}

/** 某客戶的報價單摘要（不含品項，供客戶 360 頁面顯示） */
export async function listQuotesByCustomer(customerId: string): Promise<Quote[]> {
  const resp: any = await notion.databases.query({
    database_id: QUOTES_DB(),
    filter: { property: '客戶ID', rich_text: { equals: customerId } },
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: 50,
  })
  return resp.results.filter((p: any) => !p.archived).map((p: any) => mapQuote(p))
}

// ── 寫入 ─────────────────────────────────────────────────────────────────────
export interface QuoteInput {
  customerName: string
  customerId: string
  companyTitle: string
  contactPerson: string
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  quoteDate: string
  validUntil: string
  paymentTerms: string
  deliveryTerms: string
  taxMode: TaxMode
  discount: number
  layout: string
  note: string
  items: QuoteItem[]
}

/** T-民國年月日＋兩碼流水號（台灣時間）。例：2026-10-07 第 1 張 → T-115100701 */
async function generateQuoteNumber(): Promise<string> {
  const today = todayTW()
  const [y, m, d] = today.split('-')
  const prefix = `T-${Number(y) - 1911}${m}${d}`
  const resp: any = await notion.databases.query({
    database_id: QUOTES_DB(),
    filter: { property: '建立時間', created_time: { on_or_after: new Date(`${today}T00:00:00+08:00`).toISOString() } },
    page_size: 100,
  })
  const maxSeq = (resp.results ?? [])
    .map((p: any) => quoteNumberOf(p))
    .filter((n: string) => n.startsWith(prefix))
    .reduce((max: number, n: string) => {
      const seq = Number(n.slice(prefix.length))
      return Number.isFinite(seq) ? Math.max(max, seq) : max
    }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`
}

function quoteProperties(input: QuoteInput) {
  const totals = computeQuoteTotals(input)
  return {
    客戶名稱: { rich_text: longText(input.customerName) },
    客戶ID:   { rich_text: longText(input.customerId) },
    公司抬頭: { rich_text: longText(input.companyTitle) },
    聯絡人:   { rich_text: longText(input.contactPerson) },
    電話:     { rich_text: longText(input.customerPhone) },
    地址:     { rich_text: longText(input.customerAddress) },
    統一編號: { rich_text: longText(input.customerTaxId) },
    業務姓名: { rich_text: longText(input.salesperson) },
    付款條件: { rich_text: longText(input.paymentTerms) },
    交貨條件: { rich_text: longText(input.deliveryTerms) },
    備註:     { rich_text: longText(input.note) },
    版面設定: { rich_text: longText(input.layout) },
    稅別:     { select: { name: input.taxMode } },
    折讓:     { number: totals.discount },
    總金額:   { number: totals.total },
    報價日期: input.quoteDate ? { date: { start: input.quoteDate } } : { date: null },
    有效期限: input.validUntil ? { date: { start: input.validUntil } } : { date: null },
  }
}

async function writeItems(quoteId: string, items: QuoteItem[]) {
  // 依序建立（序號保順序；逐筆以免觸發 Notion 速率限制）
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    await notionCallWithRetry('quotes:item:create', () => notion.pages.create({
      parent: { database_id: ITEMS_DB() },
      properties: {
        品名:   { title: longText(item.name) },
        報價單: { relation: [{ id: quoteId }] },
        序號:   { number: i + 1 },
        品牌:   { rich_text: longText(item.isCustom ? (item.brand || '客製化') : item.brand) },
        品類:   { rich_text: longText(item.category) },
        規格:   { rich_text: longText(item.spec) },
        單位:   { rich_text: longText(item.unit) },
        單價:   { number: item.unitPrice },
        數量:   { number: item.quantity },
        備註:   { rich_text: longText(item.note) },
        ...(item.imageUrl ? { 圖片URL: { url: item.imageUrl } } : {}),
      } as any,
    }))
  }
}

export async function createQuote(input: QuoteInput & { appUrl: string; status: '草稿' | '待行政審核' }): Promise<Quote> {
  await ensureSchema()
  const quoteNumber = await generateQuoteNumber()
  const page: any = await notionCallWithRetry('quotes:create', () => notion.pages.create({
    parent: { database_id: QUOTES_DB() },
    properties: {
      Name: { title: longText(quoteNumber) },
      編號: { rich_text: longText(quoteNumber) },
      狀態: { select: { name: input.status } },
      ...quoteProperties(input),
    } as any,
  }))
  const shareUrl = `${input.appUrl}/share/${page.id.replace(/-/g, '')}`
  await notion.pages.update({ page_id: page.id, properties: { 分享連結: { url: shareUrl } } as any })
  await writeItems(page.id, input.items)
  return (await getQuote(page.id))!
}

/**
 * 修改報價單內容（含明細整批替換）。狀態檢查由呼叫端依 lib/quote-status 做；
 * nextStatus 有值時一併轉換（例：已退回修改後送出審核）。
 */
export async function updateQuote(pageId: string, input: QuoteInput, nextStatus?: string): Promise<Quote> {
  await ensureSchema()
  const id = toUuid(pageId)
  const oldItems = await listItemPages(id)
  await notionCallWithRetry('quotes:update', () => notion.pages.update({
    page_id: id,
    properties: {
      ...quoteProperties(input),
      // 審核意見保留：重新送審時審核者可對照上次退回的原因
      ...(nextStatus ? { 狀態: { select: { name: nextStatus } } } : {}),
    } as any,
  }))
  // 先寫新明細再封存舊的：中途失敗時寧可多出舊明細（看得到、可再存一次），也不要整張變空
  await writeItems(id, input.items)
  for (const p of oldItems) {
    await notionCallWithRetry('quotes:item:archive', () => notion.pages.update({ page_id: p.id, archived: true }))
  }
  return (await getQuote(id))!
}

export async function updateQuoteStatus(pageId: string, status: string, approvalNote?: string): Promise<void> {
  const properties: any = { 狀態: { select: { name: status } } }
  if (approvalNote !== undefined) properties['審核意見'] = { rich_text: longText(approvalNote) }
  await notion.pages.update({ page_id: toUuid(pageId), properties })
}

export async function deleteQuote(pageId: string): Promise<void> {
  const id = toUuid(pageId)
  const items = await listItemPages(id)
  for (const p of items) await notion.pages.update({ page_id: p.id, archived: true })
  await notion.pages.update({ page_id: id, archived: true })
}
