/**
 * lib/notion/tenders-db.ts — 政府標案 Notion DB（葉領域）
 *
 * 標案從快取升級成正式資料表的理由：要能長期保存、能做報表、能跟客戶主檔關聯。
 * 分工：
 *   - 公告事實（名稱、機關、金額、決標結果）由每日排程 upsert，人不該改
 *   - 追蹤決定（狀態、負責業務、備註）由業務維護，排程**永遠不覆蓋**
 * 以「標案ID＝機關代碼|案號」為唯一鍵；同一案的後續公告（更正、決標）更新同一列。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getTitle, getText, getSelect, getDate, getNumber, richText,
} from './shared'
import type { TenderRecord } from '@/lib/tender-source'

export const TENDER_STATUSES = ['待評估', '投標中', '已投標', '得標', '未得標', '放棄'] as const
export type TenderStatus = (typeof TENDER_STATUSES)[number]

export type TenderRow = TenderRecord & {
  pageId: string
  status: TenderStatus
  owner: string
  note: string
  customerId: string
  customerName: string
  weBid: boolean
  dataSource: string
}

const dbId = () => process.env.NOTION_TENDERS_DB ?? '3e3dcdaafb2a81288561f750924ea729'

const num = (v: number | null) => (typeof v === 'number' ? { number: v } : { number: null })
const dateProp = (v: string) => (v ? { date: { start: v.slice(0, 10) } } : { date: null })

function mapRow(page: any): TenderRow {
  const p = page.properties
  return {
    pageId: page.id,
    id: getText(page, '標案ID'),
    unitId: getText(page, '機關代碼'),
    jobNumber: getText(page, '案號'),
    unitName: getText(page, '機關名稱'),
    title: getTitle(page, '標案名稱'),
    type: getSelect(page, '公告類型'),
    date: getDate(page, '公告日'),
    category: getText(page, '標的分類'),
    matched: getText(page, '命中關鍵字').split('、').filter(Boolean),
    tier: 1,
    budget: getNumber(page, '預算金額') || null,
    budgetText: '',
    deadline: getDate(page, '截止投標'),
    address: '',
    city: getSelect(page, '縣市'),
    district: getText(page, '行政區'),
    contact: getText(page, '聯絡人'),
    phone: getText(page, '聯絡電話'),
    url: p?.['公告連結']?.url ?? '',
    winner: getText(page, '得標廠商'),
    awardAmount: getNumber(page, '決標金額') || null,
    basePrice: getNumber(page, '底價') || null,
    bidders: getText(page, '投標廠商').split('、').filter(Boolean),
    status: (getSelect(page, '狀態') || '待評估') as TenderStatus,
    owner: getSelect(page, '負責業務'),
    note: getText(page, '備註'),
    customerId: (p?.['關聯客戶']?.relation?.[0]?.id ?? '').replace(/-/g, ''),
    customerName: '',
    weBid: p?.['崧達有投標']?.checkbox ?? false,
    dataSource: getSelect(page, '資料來源'),
  }
}

export async function listTenderRows(): Promise<TenderRow[]> {
  const out: TenderRow[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listTenderRows', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(dbId()),
        page_size: 100,
        sorts: [{ property: '公告日', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) out.push(mapRow(page))
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}

type IndexEntry = { pageId: string; status: string; owner: string; note: string }

/**
 * 既有列的索引（upsert 用）：主鍵是標案ID，另外以「機關名稱＋案號」當備用鍵。
 * 備用鍵的用途：官網明細頁常被機器人驗證擋下，當下拿不到機關代碼，標案ID 只能用機關名稱組；
 * 之後補到機關代碼時要更新到**同一列**，不能變成兩筆。
 */
async function indexByTenderId(): Promise<{ byId: Map<string, IndexEntry>; byUnitJob: Map<string, IndexEntry> }> {
  const byId = new Map<string, IndexEntry>()
  const byUnitJob = new Map<string, IndexEntry>()
  for (const r of await listTenderRows()) {
    const entry = { pageId: r.pageId, status: r.status, owner: r.owner, note: r.note }
    byId.set(r.id, entry)
    if (r.unitName && r.jobNumber) byUnitJob.set(`${r.unitName}|${r.jobNumber}`, entry)
  }
  return { byId, byUnitJob }
}

/** 還沒補到明細（機關代碼空白）的列，交給抓取端慢慢補 */
export async function listTendersNeedingDetail(limit = 5): Promise<TenderRow[]> {
  const rows = await listTenderRows()
  return rows.filter((r) => !r.unitId && r.url).slice(0, limit)
}

export type UpsertInput = TenderRecord & {
  customerId?: string
  weBid?: boolean
  /** 官方開放資料（可商用）或即時API（近兩個月、授權為合理使用範圍） */
  dataSource?: '官方開放資料' | '即時API'
  /** 決標後系統自動結案用；只有在使用者尚未手動改狀態時才套用 */
  autoStatus?: TenderStatus
}

/**
 * 寫入／更新標案。公告事實一律覆寫；**狀態、負責業務、備註不覆寫**（那是人的決定）。
 * 例外：autoStatus——案子已決標而追蹤還停在投標中／已投標時，由系統結案。
 */
export async function upsertTenders(records: UpsertInput[]): Promise<{ created: number; updated: number }> {
  const { byId, byUnitJob } = await indexByTenderId()
  let created = 0, updated = 0

  for (const r of records) {
    const props: Record<string, any> = {
      '標案名稱': { title: richText(r.title || r.jobNumber) },
      '標案ID':   { rich_text: richText(r.id) },
      '案號':     { rich_text: richText(r.jobNumber) },
      '機關名稱': { rich_text: richText(r.unitName) },
      '機關代碼': { rich_text: richText(r.unitId) },
      '行政區':   { rich_text: richText(r.district) },
      '標的分類': { rich_text: richText(r.category) },
      '公告日':   dateProp(r.date),
      '截止投標': dateProp(r.deadline),
      '預算金額': num(r.budget),
      '決標金額': num(r.awardAmount),
      '底價':     num(r.basePrice),
      '得標廠商': { rich_text: richText(r.winner) },
      '投標廠商': { rich_text: richText(r.bidders.join('、').slice(0, 1800)) },
      '命中關鍵字': { rich_text: richText(r.matched.join('、')) },
      '聯絡人':   { rich_text: richText(r.contact) },
      '聯絡電話': { rich_text: richText(r.phone) },
      // 只在確認有投標時打勾：招標公告階段看不到投標廠商，若一律覆寫會把先前查到的事實清掉
      ...(r.weBid ? { '崧達有投標': { checkbox: true } } : {}),
      ...(r.city ? { '縣市': { select: { name: r.city } } } : {}),
      ...(r.type ? { '公告類型': { select: { name: r.type } } } : {}),
      ...(r.url ? { '公告連結': { url: r.url } } : {}),
      ...(r.dataSource ? { '資料來源': { select: { name: r.dataSource } } } : {}),
      ...(r.customerId ? { '關聯客戶': { relation: [{ id: r.customerId }] } } : {}),
    }

    const existing = byId.get(r.id) ?? byUnitJob.get(`${r.unitName}|${r.jobNumber}`)
    if (!existing) {
      await notionCallWithRetry('upsertTenders:create', () =>
        notion.pages.create({
          parent: { database_id: normalizeDatabaseId(dbId()) },
          // 新列只有在「我們真的投過標」時才直接標得標／未得標；
          // 其餘決標案只是市場情報，標成「未得標」會讓人誤以為我們投了卻輸掉
          properties: { ...props, '狀態': { select: { name: (r.weBid && r.autoStatus) ? r.autoStatus : '待評估' } } } as any,
        })
      )
      created++
      continue
    }
    // 只有「系統自動結案」這一種情況可以動狀態，其餘保留人的設定
    const canAutoClose = r.autoStatus && ['投標中', '已投標'].includes(existing.status)
    await notionCallWithRetry('upsertTenders:update', () =>
      notion.pages.update({
        page_id: existing.pageId,
        properties: {
          ...props,
          ...(canAutoClose ? { '狀態': { select: { name: r.autoStatus } } } : {}),
          ...(canAutoClose && r.winner
            ? { '備註': { rich_text: richText(`${existing.note ? existing.note + '｜' : ''}決標：${r.winner}${r.awardAmount ? ` ${r.awardAmount.toLocaleString()} 元` : ''}`) } }
            : {}),
        } as any,
      })
    )
    updated++
  }
  return { created, updated }
}

/** 業務更新追蹤欄位（狀態／負責業務／備註）——只動這三個，不碰公告事實 */
export async function updateTenderTrack(pageId: string, patch: {
  status?: TenderStatus; owner?: string | null; note?: string
}): Promise<void> {
  const props: Record<string, any> = {}
  if (patch.status) props['狀態'] = { select: { name: patch.status } }
  if (patch.owner !== undefined) props['負責業務'] = patch.owner ? { select: { name: patch.owner } } : { select: null }
  if (patch.note !== undefined) props['備註'] = { rich_text: richText(patch.note) }
  if (Object.keys(props).length === 0) return
  await notionCallWithRetry('updateTenderTrack', () =>
    notion.pages.update({ page_id: pageId, properties: props as any })
  )
}
