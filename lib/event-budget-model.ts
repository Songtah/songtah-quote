/**
 * lib/event-budget-model.ts — 活動預算核銷的資料形狀與狀態機（前後端共用，不含資料庫存取）。
 *
 * 一場活動：先編預算項目，之後逐筆登記支出（附憑證）→ 送審 → 核准／退回 → 行政標記已付款。
 * 狀態轉換只認 EXPENSE_TRANSITIONS，新增動作先改這張表（比照報價單、訂貨單狀態機）。
 */
export const BUDGET_CATEGORIES = ['場地', '講師', '教材印刷', '行銷廣告', '餐飲', '交通住宿', '贈品', '設備租借', '人事', '其他'] as const
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]

export const EXPENSE_STATUSES = ['草稿', '待審核', '已核准', '已退回', '已付款'] as const
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export type BudgetItem = { id: string; category: string; name: string; amount: number; note: string }
export type Expense = {
  id: string; category: string; description: string; amount: number; spentDate: string; payee: string
  receiptUrl: string; note: string; status: ExpenseStatus; createdBy: string; submittedAt: string
  reviewedBy: string; reviewedAt: string; reviewNote: string; paidBy: string; paidAt: string; createdAt: string
}

/** 誰能做哪個動作：editor＝有活動管理編輯權限；approver＝核准請款的人；payer＝標記已付款的人 */
export type ExpenseActor = 'editor' | 'approver' | 'payer'
export type ExpenseAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'pay'
export const EXPENSE_TRANSITIONS: Record<ExpenseAction, { from: ExpenseStatus[]; to: ExpenseStatus; actor: ExpenseActor; label: string }> = {
  submit:   { from: ['草稿', '已退回'], to: '待審核', actor: 'editor',   label: '送審' },
  withdraw: { from: ['待審核'],         to: '草稿',   actor: 'editor',   label: '撤回' },
  approve:  { from: ['待審核'],         to: '已核准', actor: 'approver', label: '核准' },
  reject:   { from: ['待審核'],         to: '已退回', actor: 'approver', label: '退回' },
  pay:      { from: ['已核准'],         to: '已付款', actor: 'payer',    label: '標記已付款' },
}
/** 內容只有草稿與已退回可改；只有草稿可刪 */
export const EXPENSE_EDITABLE: ExpenseStatus[] = ['草稿', '已退回']

/**
 * 核准與付款的權限（2026-11-10）：使用者表示之後會新增「財務」帳號類型。
 * 在那之前由中央管理／總經理核准、行政／中央管理標記付款；「財務」一建立就自動具備兩者。
 */
export const EXPENSE_APPROVER_TYPES = ['中央管理', '總經理', '財務']
export const EXPENSE_PAYER_TYPES = ['中央管理', '行政', '財務']
export function expenseRoles(user: { role?: string; accountType?: string } | null | undefined, canEditEvents: boolean) {
  const admin = user?.role === 'admin'
  return {
    editor: canEditEvents,
    approver: admin || EXPENSE_APPROVER_TYPES.includes(user?.accountType ?? ''),
    payer: admin || EXPENSE_PAYER_TYPES.includes(user?.accountType ?? ''),
  }
}

export type BudgetSummary = {
  budget: number; spent: number; pending: number; draft: number; remaining: number
  byCategory: { category: string; budget: number; spent: number; pending: number }[]
}
/** spent＝已核准＋已付款；pending＝待審核；draft＝草稿＋已退回（都還沒算進支出） */
export function summarizeBudget(items: BudgetItem[], expenses: Expense[]): BudgetSummary {
  const cats = new Map<string, { category: string; budget: number; spent: number; pending: number }>()
  const cat = (c: string) => { let x = cats.get(c); if (!x) { x = { category: c, budget: 0, spent: 0, pending: 0 }; cats.set(c, x) } return x }
  let budget = 0, spent = 0, pending = 0, draft = 0
  for (const i of items) { budget += i.amount; cat(i.category).budget += i.amount }
  for (const e of expenses) {
    if (e.status === '已核准' || e.status === '已付款') { spent += e.amount; cat(e.category).spent += e.amount }
    else if (e.status === '待審核') { pending += e.amount; cat(e.category).pending += e.amount }
    else draft += e.amount
  }
  const order = (c: string) => { const i = (BUDGET_CATEGORIES as readonly string[]).indexOf(c); return i < 0 ? 99 : i }
  return { budget, spent, pending, draft, remaining: budget - spent, byCategory: Array.from(cats.values()).sort((a, b) => order(a.category) - order(b.category)) }
}
