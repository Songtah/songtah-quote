/**
 * lib/event-report.ts — 活動結案報告（組合層：報名、客戶、客情、問卷、預算、報價、訂單）。只在伺服器端使用。
 *
 * 報告上每個數字的定義（使用者 2026-11-11 選定四個區塊；畫面上同樣寫明算法）：
 *  參與成果
 *    報名筆數／人數   未取消的報名紀錄數／其「人數」加總
 *    到場人數         狀態＝已到場者的人數加總；出席率＝到場人數 ÷ 報名人數
 *    配對到的客戶     報名名單＋活動問卷／滿意度調查回覆配到的客戶主檔，同一家只算一次（2026-11-14：展覽沒有報名，客戶只來自問卷）
 *    既有往來客戶     配對到的客戶中，活動開始日以前已有客情紀錄，或標記「公司既有客戶」
 *    首次接觸客戶     配對到的客戶中，不屬於上者
 *    未配對           沒有配對到客戶主檔的報名筆數＋有留個人資料、但沒配到客戶的問卷回覆筆數
 *  費用
 *    每位成本         已核准支出 ÷ 到場人數（沒有人被標記到場時改除以報名人數，並註明）
 *    報名費已收       付款狀態＝已付款的應繳金額加總
 *  會後追蹤（追蹤期＝活動結束日起 60 天）
 *    已拜訪／未拜訪   配對到的客戶在追蹤期內有沒有客情紀錄
 *    會後報價／訂單   配對到的客戶在活動結束日之後建立的報價單／訂貨單張數；金額只有中央管理看得到
 */
import { sql } from '@/lib/db/client'
import { getEventById, listEventRegistrations } from '@/lib/notion/events'
import { getEventForm, listResponses } from '@/lib/db/event-forms'
import { summarize, type QuestionSummary } from '@/lib/event-forms-model'
import { listBudget } from '@/lib/db/event-budget'
import { summarizeBudget, type BudgetSummary } from '@/lib/event-budget-model'

const bare = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
export const FOLLOW_UP_DAYS = 60
/** 系統只收 2025-12 以後的客情紀錄（更早的日報不夠詳細、未匯入），在這之前結束的活動無法判斷會後有沒有拜訪 */
export const VISIT_DATA_FROM = '2025-12-01'
const cityName = (v: string) => (v || '').replace(/^台/, '臺')

export type EventReport = {
  event: { id: string; name: string; date: string; endDate: string; location: string; type: string; status: string }
  generatedAt: string
  participation: {
    registrations: number; people: number; cancelled: number
    attended: number; attendanceMarked: boolean; attendanceRate: number | null
    matchedCustomers: number; existingCustomers: number; firstContactCustomers: number; unmatched: number
    /** 只出現在問卷回覆（沒有報名）的客戶數 */
    fromFormsOnly: number
    bySource: { label: string; count: number }[]
    byUnitType: { label: string; count: number }[]
    byCity: { label: string; count: number }[]
  }
  forms: {
    survey: null | { open: boolean; responses: number; giftClaimed: number; gift: string; summary: QuestionSummary[] }
    satisfaction: null | { open: boolean; responses: number; average: number | null; ratingQuestions: number; summary: QuestionSummary[] }
  }
  cost: {
    budget: BudgetSummary
    feeCollected: number; feeOutstanding: number
    perHead: number | null; perHeadBasis: '到場人數' | '報名人數' | null
  }
  followUp: {
    days: number; windowEnd: string; windowOpen: boolean; started: boolean
    /** true＝活動結束日早於系統有客情紀錄的起點，已拜訪／未拜訪不可信 */
    visitDataGap: boolean
    visited: number; notVisited: number
    notVisitedList: { id: string; name: string; area: string; owner: string }[]
    quotes: number; orders: number
    /** 只有中央管理拿得到；其他人為 null */
    quoteAmount: number | null; orderAmount: number | null
  }
}

const tally = (values: string[], limit = 8) => {
  const m = new Map<string, number>()
  for (const v of values) m.set(v || '未填', (m.get(v || '未填') ?? 0) + 1)
  const all = Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  if (all.length <= limit) return all
  return [...all.slice(0, limit - 1), { label: '其他', count: all.slice(limit - 1).reduce((s, x) => s + x.count, 0) }]
}

export async function buildEventReport(eventId: string, opts: { showAmounts: boolean }): Promise<EventReport | null> {
  const event = await getEventById(eventId)
  if (!event) return null
  const db = sql()
  const start = event.date || ''
  const end = event.endDate || event.date || ''
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const windowEnd = end ? new Date(Date.parse(end + 'T00:00:00Z') + FOLLOW_UP_DAYS * 86_400_000).toISOString().slice(0, 10) : ''

  const [regsAll, surveyForm, satForm, budgetData] = await Promise.all([
    listEventRegistrations(eventId), getEventForm(eventId, 'survey'), getEventForm(eventId, 'satisfaction'), listBudget(eventId),
  ])
  const regs = regsAll.filter((r) => r.status !== '取消')
  const people = regs.reduce((s, r) => s + (r.attendees || 1), 0)
  const attendedRegs = regs.filter((r) => r.status === '已到場')
  const attended = attendedRegs.reduce((s, r) => s + (r.attendees || 1), 0)

  // ── 問卷與滿意度（客戶統計也要用到配對結果，先讀） ──
  const [surveyRes, satRes] = await Promise.all([surveyForm ? listResponses(surveyForm.id) : [], satForm ? listResponses(satForm.id) : []])
  const formRes = [...surveyRes, ...satRes].filter((r) => r.name || r.phone || r.institution || r.email)

  // ── 客戶：既有往來／首次接觸（報名＋問卷回覆配到的客戶，同一家只算一次） ──
  const regCustIds = new Set(regs.map((r) => bare(r.customerId)).filter(Boolean))
  const custIds = Array.from(new Set(Array.from(regCustIds).concat(formRes.map((r) => bare(r.customerId)).filter(Boolean))))
  const custRows = custIds.length
    ? await db`select replace(notion_page_id,'-','') id, name, county, district, owner, customer_type, dev_status_tags from customers where replace(notion_page_id,'-','') = any(${custIds})`
    : []
  const cust = new Map<string, any>(custRows.map((r: any) => [r.id, r]))
  const priorRows = custIds.length && start
    ? await db`select distinct replace(customer_notion_id,'-','') id from visits where replace(customer_notion_id,'-','') = any(${custIds}) and visit_date < ${start}`
    : []
  const prior = new Set(priorRows.map((r: any) => r.id))
  const matched = custIds.filter((id) => cust.has(id))
  const existing = matched.filter((id) => prior.has(id) || ((cust.get(id).dev_status_tags ?? []) as string[]).includes('公司既有客戶'))

  // ── 問卷與滿意度彙總 ──
  const satSummary = satForm ? summarize(satForm, satRes) : []
  const ratingQs = satSummary.filter((q) => q.type === 'rating' && q.answered > 0)
  const satAverage = ratingQs.length ? Math.round((ratingQs.reduce((s, q) => s + (q.average ?? 0), 0) / ratingQs.length) * 10) / 10 : null

  // ── 費用 ──
  const budget = summarizeBudget(budgetData.items, budgetData.expenses)
  const feeCollected = regs.filter((r) => r.paymentStatus === '已付款').reduce((s, r) => s + (r.amount || 0), 0)
  const feeOutstanding = regs.filter((r) => r.paymentStatus === '未付款').reduce((s, r) => s + (r.amount || 0), 0)
  const basisCount = attended > 0 ? attended : people
  const perHead = budget.spent > 0 && basisCount > 0 ? Math.round(budget.spent / basisCount) : null

  // ── 會後追蹤 ──
  const started = !!end && today >= end
  let visitedIds = new Set<string>()
  if (matched.length && end && started) {
    const v = await db`select distinct replace(customer_notion_id,'-','') id from visits where replace(customer_notion_id,'-','') = any(${matched}) and visit_date >= ${end} and visit_date <= ${windowEnd}`
    visitedIds = new Set(v.map((r: any) => r.id))
  }
  const notVisitedList = started ? matched.filter((id) => !visitedIds.has(id)).map((id) => {
    const c = cust.get(id)
    return { id: c.id as string, name: c.name as string, area: `${c.county ?? ''}${c.district ?? ''}`, owner: (c.owner as string) || '未分派' }
  }).sort((a, b) => a.owner.localeCompare(b.owner, 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW')) : []

  let quotes = 0, orders = 0, quoteAmount = 0, orderAmount = 0
  if (matched.length && end && started) {
    const q = await db`select count(*)::int n, coalesce(sum((properties->'總金額'->>'number')::numeric), 0)::float amt from notion_pages
      where db_id = (select db_id from notion_databases where title like '報價單%' limit 1) and not archived
        and replace(coalesce(properties->'客戶ID'->'rich_text'->0->>'plain_text', ''), '-', '') = any(${matched}) and created_time >= ${end}::date`
    const o = await db`select count(*)::int n, coalesce(sum((properties->'總金額'->>'number')::numeric), 0)::float amt from notion_pages
      where db_id = (select db_id from notion_databases where title like '訂貨單%' limit 1) and not archived
        and coalesce(properties->'狀態'->'select'->>'name', '') not in ('草稿', '已取消')
        and replace(coalesce(properties->'客戶ID'->'rich_text'->0->>'plain_text', ''), '-', '') = any(${matched}) and created_time >= ${end}::date`
    quotes = q[0].n; quoteAmount = q[0].amt; orders = o[0].n; orderAmount = o[0].amt
  }

  return {
    event: { id: event.id, name: event.name, date: event.date, endDate: event.endDate, location: event.location, type: event.type, status: event.status },
    generatedAt: new Date().toISOString(),
    participation: {
      registrations: regs.length, people, cancelled: regsAll.length - regs.length,
      attended, attendanceMarked: attendedRegs.length > 0, attendanceRate: attendedRegs.length > 0 && people > 0 ? Math.round((attended / people) * 100) : null,
      matchedCustomers: matched.length, existingCustomers: existing.length, firstContactCustomers: matched.length - existing.length,
      fromFormsOnly: matched.filter((id) => !regCustIds.has(id)).length,
      unmatched: regs.filter((r) => !r.customerId || !cust.has(bare(r.customerId))).length + formRes.filter((r) => !r.customerId || !cust.has(bare(r.customerId))).length,
      bySource: tally(regs.map((r) => r.source)),
      byUnitType: tally(regs.map((r) => r.unitType || cust.get(bare(r.customerId))?.customer_type || '')),
      byCity: tally(regs.map((r) => cityName(r.city || cust.get(bare(r.customerId))?.county || ''))),
    },
    forms: {
      survey: surveyForm ? { open: surveyForm.open, responses: surveyRes.length, giftClaimed: surveyRes.filter((r) => r.giftClaimedAt).length, gift: surveyForm.gift, summary: summarize(surveyForm, surveyRes).map((q) => ({ ...q, texts: undefined })) } : null,
      satisfaction: satForm ? { open: satForm.open, responses: satRes.length, average: satAverage, ratingQuestions: ratingQs.length, summary: satSummary.map((q) => ({ ...q, texts: q.texts?.slice(0, 8) })) } : null,
    },
    cost: { budget, feeCollected, feeOutstanding, perHead, perHeadBasis: perHead == null ? null : attended > 0 ? '到場人數' : '報名人數' },
    followUp: {
      days: FOLLOW_UP_DAYS, windowEnd, windowOpen: !!windowEnd && today <= windowEnd, started,
      visitDataGap: !!end && end < VISIT_DATA_FROM,
      visited: visitedIds.size, notVisited: notVisitedList.length, notVisitedList: notVisitedList.slice(0, 200),
      quotes, orders, quoteAmount: opts.showAmounts ? quoteAmount : null, orderAmount: opts.showAmounts ? orderAmount : null,
    },
  }
}
