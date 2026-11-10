/**
 * lib/db/event-budget.ts — 活動預算核銷的資料庫存取（Supabase）。只在伺服器端使用。
 * 形狀與狀態機在 lib/event-budget-model.ts。
 */
import { sql } from './client'
import { BUDGET_CATEGORIES, EXPENSE_EDITABLE, EXPENSE_TRANSITIONS, type BudgetItem, type Expense, type ExpenseAction } from '@/lib/event-budget-model'

const bare = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
const iso = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v))
const d10 = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

const toItem = (r: any): BudgetItem => ({ id: r.id, category: r.category, name: r.name, amount: r.amount, note: r.note })
const toExpense = (r: any): Expense => ({
  id: r.id, category: r.category, description: r.description, amount: r.amount, spentDate: d10(r.spent_date), payee: r.payee,
  receiptUrl: r.receipt_url, note: r.note, status: r.status, createdBy: r.created_by, submittedAt: iso(r.submitted_at),
  reviewedBy: r.reviewed_by ?? '', reviewedAt: iso(r.reviewed_at), reviewNote: r.review_note ?? '', paidBy: r.paid_by ?? '', paidAt: iso(r.paid_at), createdAt: iso(r.created_at),
})

function category(v: unknown): string {
  const c = clip(v, 20)
  if (!(BUDGET_CATEGORIES as readonly string[]).includes(c)) throw new Error('請選擇費用類別')
  return c
}
function amount(v: unknown, allowZero: boolean): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 100_000_000) throw new Error('金額請填正整數')
  return n
}
/** 憑證只收本系統 Vercel Blob 的網址（上傳端點回傳的），不接受任意外部連結 */
function receipt(v: unknown): string {
  const u = clip(v, 500)
  if (!u) return ''
  try { const h = new URL(u); if (h.protocol === 'https:' && h.hostname.endsWith('.public.blob.vercel-storage.com')) return u } catch {}
  throw new Error('憑證請用上傳的方式')
}

export async function listBudget(eventId: string): Promise<{ items: BudgetItem[]; expenses: Expense[] }> {
  const db = sql()
  const [items, expenses] = await Promise.all([
    db`select * from event_budget_items where event_id = ${bare(eventId)} order by created_at`,
    db`select * from event_expenses where event_id = ${bare(eventId)} order by created_at desc`,
  ])
  return { items: items.map(toItem), expenses: expenses.map(toExpense) }
}

export async function addBudgetItem(eventId: string, input: any): Promise<BudgetItem> {
  const r = await sql()`insert into event_budget_items (event_id, category, name, amount, note)
    values (${bare(eventId)}, ${category(input?.category)}, ${clip(input?.name, 100)}, ${amount(input?.amount, true)}, ${clip(input?.note, 300)}) returning *`
  return toItem(r[0])
}
export async function updateBudgetItem(eventId: string, id: string, input: any): Promise<BudgetItem | null> {
  if (!isUuid(id)) return null
  const r = await sql()`update event_budget_items set category = ${category(input?.category)}, name = ${clip(input?.name, 100)}, amount = ${amount(input?.amount, true)}, note = ${clip(input?.note, 300)}
    where id = ${id} and event_id = ${bare(eventId)} returning *`
  return r.length ? toItem(r[0]) : null
}
export async function deleteBudgetItem(eventId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  return (await sql()`delete from event_budget_items where id = ${id} and event_id = ${bare(eventId)}`).count > 0
}

function expenseFields(input: any) {
  const spent = clip(input?.spentDate, 10)
  return {
    category: category(input?.category), description: clip(input?.description, 200), amount: amount(input?.amount, false),
    spent_date: /^\d{4}-\d{2}-\d{2}$/.test(spent) ? spent : null, payee: clip(input?.payee, 100), receipt_url: receipt(input?.receiptUrl), note: clip(input?.note, 500),
  }
}
export async function addExpense(eventId: string, input: any, by: string): Promise<Expense> {
  const f = expenseFields(input)
  if (!f.description) throw new Error('請填寫支出說明')
  const r = await sql()`insert into event_expenses (event_id, category, description, amount, spent_date, payee, receipt_url, note, created_by)
    values (${bare(eventId)}, ${f.category}, ${f.description}, ${f.amount}, ${f.spent_date}, ${f.payee}, ${f.receipt_url}, ${f.note}, ${by}) returning *`
  return toExpense(r[0])
}
export async function getExpense(eventId: string, id: string): Promise<Expense | null> {
  if (!isUuid(id)) return null
  const r = await sql()`select * from event_expenses where id = ${id} and event_id = ${bare(eventId)}`
  return r.length ? toExpense(r[0]) : null
}
/** 只有草稿／已退回可改內容 */
export async function updateExpense(eventId: string, id: string, input: any): Promise<Expense> {
  const cur = await getExpense(eventId, id)
  if (!cur) throw new Error('找不到這筆支出')
  if (!EXPENSE_EDITABLE.includes(cur.status)) throw new Error(`「${cur.status}」的支出不能修改內容`)
  const f = expenseFields(input)
  if (!f.description) throw new Error('請填寫支出說明')
  const r = await sql()`update event_expenses set category = ${f.category}, description = ${f.description}, amount = ${f.amount}, spent_date = ${f.spent_date},
    payee = ${f.payee}, receipt_url = ${f.receipt_url}, note = ${f.note}, updated_at = now() where id = ${id} and status = ${cur.status} returning *`
  if (!r.length) throw new Error('這筆支出的狀態剛被別人改過，請重新整理')
  return toExpense(r[0])
}
export async function deleteExpense(eventId: string, id: string): Promise<void> {
  const cur = await getExpense(eventId, id)
  if (!cur) throw new Error('找不到這筆支出')
  if (cur.status !== '草稿') throw new Error('只有草稿可以刪除')
  await sql()`delete from event_expenses where id = ${id} and status = '草稿'`
}

/** 依狀態機轉換；以「目前狀態」作為更新條件，兩人同時操作只有一人成功 */
export async function transitionExpense(eventId: string, id: string, action: ExpenseAction, by: string, note = ''): Promise<{ before: Expense; after: Expense }> {
  const rule = EXPENSE_TRANSITIONS[action]
  if (!rule) throw new Error('不明的動作')
  const cur = await getExpense(eventId, id)
  if (!cur) throw new Error('找不到這筆支出')
  if (!rule.from.includes(cur.status)) throw new Error(`「${cur.status}」的支出不能${rule.label}`)
  if (action === 'reject' && !note.trim()) throw new Error('退回請填寫原因')
  const db = sql()
  const patch: Record<string, any> = { status: rule.to, updated_at: new Date().toISOString() }
  if (action === 'submit') { patch.submitted_at = new Date().toISOString(); patch.reviewed_by = null; patch.reviewed_at = null }
  if (action === 'withdraw') patch.submitted_at = null
  if (action === 'approve' || action === 'reject') { patch.reviewed_by = by; patch.reviewed_at = new Date().toISOString(); patch.review_note = note.trim().slice(0, 300) }
  if (action === 'pay') { patch.paid_by = by; patch.paid_at = new Date().toISOString() }
  const r = await db`update event_expenses set ${db(patch)} where id = ${id} and status = ${cur.status} returning *`
  if (!r.length) throw new Error('這筆支出的狀態剛被別人改過，請重新整理')
  return { before: cur, after: toExpense(r[0]) }
}
