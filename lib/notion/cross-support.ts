/**
 * lib/notion/cross-support.ts — 跨區支援報備（葉領域）
 *
 * 業務跨區支援其他業務的客戶時的報備紀錄。刻意設計成不掛勾訂單/業績計算，
 * 只關聯客戶主檔(相關規則見 CLAUDE.md「業務開發漏斗鐵則」的機構狀態/開發階段分離精神——
 * 這裡是另一種「報備語意不可混進其他領域資料」的應用)。
 *
 * 資料來源：Slack「業務開發-討論區」頻道文字訊息(固定標籤格式)→ Events API webhook
 * (見 app/api/webhooks/slack-cross-support、lib/slack-cross-support-parser.ts)。
 * 客戶比對(依姓名/縣市搜尋)屬於「跨領域查詢」，由呼叫端(webhook route)用 customers.ts 的
 * searchSystemCustomers 做完再把已解析的 customerId 傳進來——本檔不直接 import customers.ts，
 * 只用 ./relations 的 resolveCustomerInfo 把 relation id 轉回顯示用的名稱/縣市(讀取方向，允許)。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getText, getSelect, getDate, getRelationIds,
} from './shared'
import { resolveCustomerInfo } from './relations'

// 純文字轉 Notion rich_text/title 陣列(不含 type 欄位,避免其字面值被寬化為 string
// 導致與 Notion SDK 的 CreatePageParameters 型別不合——比照 lib/notion/customers.ts 既有寫法)。
function toRichText(content: string) {
  return [{ text: { content: content.slice(0, 2000) } }]
}

export interface CrossSupportLog {
  id: string
  reportingSalesperson: string
  customerId: string
  customerName: string   // 由 relation 解析回填,建立時傳入的名稱不直接寫死進屬性
  customerCity: string
  supportDate: string
  reason: string
  originalSalesperson: string
  status: string
  rawMessage: string
  createdTime: string
}

function parseCrossSupportPage(page: any): Omit<CrossSupportLog, 'customerName' | 'customerCity'> {
  return {
    id: page.id.replace(/-/g, ''),
    reportingSalesperson: getSelect(page, '報備業務'),
    customerId: getRelationIds(page, '客戶')[0] ?? '',
    supportDate: getDate(page, '支援日期'),
    reason: getText(page, '支援事由'),
    originalSalesperson: getText(page, '原負責業務'),
    status: getSelect(page, '狀態'),
    rawMessage: getText(page, '原始訊息'),
    createdTime: page.created_time ?? '',
  }
}

/**
 * 建立一筆跨區支援報備。customerId 為空代表 Slack 表單填的客戶名稱比對不到任何客戶——
 * 此時狀態強制為「待確認」，relation 留空，絕不亂猜寫入錯的客戶。
 */
export async function createCrossSupportLog(data: {
  reportingSalesperson: string
  customerId: string
  customerName: string   // 供組標題用
  supportDate: string
  reason: string
  originalSalesperson: string
  rawMessage: string
}): Promise<void> {
  if (!DB.crossSupport) throw new Error('NOTION_CROSS_SUPPORT_DB 環境變數未設定')
  const status = data.customerId ? '已比對' : '待確認'
  await notion.pages.create({
    parent: { database_id: normalizeDatabaseId(DB.crossSupport) },
    properties: {
      標題: { title: toRichText(`${data.reportingSalesperson} 支援 ${data.customerName || '（客戶待確認）'} — ${data.supportDate}`) },
      報備業務: { select: { name: data.reportingSalesperson } },
      ...(data.customerId ? { 客戶: { relation: [{ id: data.customerId }] } } : {}),
      支援日期: { date: { start: data.supportDate } },
      支援事由: { rich_text: toRichText(data.reason) },
      原負責業務: { rich_text: toRichText(data.originalSalesperson) },
      狀態: { select: { name: status } },
      原始訊息: { rich_text: toRichText(data.rawMessage) },
    },
  })
}

/** 依日期範圍列出跨區支援報備,供老闆儀表板顯示(附客戶名稱/縣市,由 relation 解析回填)。 */
export async function listCrossSupportLogs(range?: { from: string; to: string }): Promise<CrossSupportLog[]> {
  if (!DB.crossSupport) return []
  const clauses: any[] = []
  if (range) {
    clauses.push({ property: '支援日期', date: { on_or_after: range.from } })
    clauses.push({ property: '支援日期', date: { on_or_before: range.to } })
  }
  const pages: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notionCallWithRetry('listCrossSupportLogs', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.crossSupport),
        filter: clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { and: clauses },
        sorts: [{ property: '支援日期', direction: 'descending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    pages.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)

  const parsed = pages.map(parseCrossSupportPage)
  const customerIds = Array.from(new Set(parsed.map((p) => p.customerId).filter(Boolean)))
  const customerInfo = await resolveCustomerInfo(customerIds)

  return parsed.map((p) => ({
    ...p,
    customerName: customerInfo[p.customerId]?.name ?? '',
    customerCity: customerInfo[p.customerId]?.city ?? '',
  }))
}
