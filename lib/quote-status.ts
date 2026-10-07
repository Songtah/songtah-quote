/**
 * lib/quote-status.ts — 報價單狀態機（唯一允許的狀態轉換來源，CLAUDE.md 鐵則：不可繞過）
 *
 * 簽核（approve/escalate/reject/resubmit）由 /api/quotes/[id]/approve 使用；
 * 「送出審核」（submit）由建立／修改報價單時使用——草稿或已退回的報價單，
 * 由有報價編輯權限的人修改後送出（2026-10-07：原本業務按「重新送審」會被 approve 的角色門擋下）。
 */

export type QuoteActorRole = 'admin' | '行政' | '總經理' | 'editor'
export type Transition = { to: string; roles: QuoteActorRole[] }

export const QUOTE_TRANSITIONS: Record<string, Record<string, Transition>> = {
  '草稿': {
    submit: { to: '待行政審核', roles: ['admin', '行政', '總經理', 'editor'] },
  },
  '待行政審核': {
    approve:  { to: '已核准',      roles: ['admin', '行政'] },
    escalate: { to: '待總經理審核', roles: ['admin', '行政'] },
    reject:   { to: '已退回',      roles: ['admin', '行政', '總經理'] },
  },
  '待總經理審核': {
    // 已呈總經理者，只有總經理（或 admin）可核准——行政不可代為核准，避免繞過審核層級。
    approve: { to: '已核准', roles: ['admin', '總經理'] },
    reject:  { to: '已退回', roles: ['admin', '行政', '總經理'] },
  },
  '已退回': {
    resubmit: { to: '待行政審核', roles: ['admin', '行政', '總經理'] },
    submit:   { to: '待行政審核', roles: ['admin', '行政', '總經理', 'editor'] },
  },
  '已核准': {
    // 允許管理員撤銷誤核准的報價單，但不可由此狀態再「approve」（已是終態）。
    reject: { to: '已退回', roles: ['admin'] },
  },
}

/** 可以修改內容的狀態：已核准後價格定格（價格快照鐵則），要改須先由管理員退回 */
export const EDITABLE_QUOTE_STATUSES = ['草稿', '待行政審核', '已退回']

export function canEditQuote(status: string) {
  return EDITABLE_QUOTE_STATUSES.includes(status)
}

export function actorRoleOf(user: any): QuoteActorRole | '' {
  if (user?.role === 'admin') return 'admin'
  if (user?.accountType === '行政') return '行政'
  if (user?.accountType === '總經理') return '總經理'
  return ''
}
