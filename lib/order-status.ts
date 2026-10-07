/**
 * lib/order-status.ts — 訂貨單狀態機（唯一允許的狀態轉換來源；前後端共用，不可 import 伺服器模組）
 *
 * 2026-10-07 整理：原本清單頁的狀態下拉任何人都能改（業務可把自己的草稿直接改成「已到貨」，
 * 連帶把客戶推成「已成交」），改由此表把關，PATCH /api/orders/[id] 依此驗證。
 *
 *   草稿 ──送出──▶ 已送出 ──確認──▶ 確認中 ──到貨──▶ 已到貨
 *    ▲  ◀─撤回／退回─┘        └────────到貨───────────▲
 *    └──────────── 恢復 ◀── 已取消 ◀── 取消（草稿／已送出／確認中）
 */

/** staff＝行政（admin／行政／中央管理）；editor＝有訂貨編輯權限的業務 */
export type OrderActor = 'staff' | 'editor'
export type OrderTransition = { to: string; label: string; roles: OrderActor[]; tone: 'primary' | 'neutral' | 'danger' }

export const ORDER_STATUSES = ['草稿', '已送出', '確認中', '已到貨', '已取消'] as const

export const ORDER_TRANSITIONS: Record<string, Record<string, OrderTransition>> = {
  '草稿': {
    submit: { to: '已送出', label: '送出訂單', roles: ['staff', 'editor'], tone: 'primary' },
    cancel: { to: '已取消', label: '取消訂單', roles: ['staff', 'editor'], tone: 'danger' },
  },
  '已送出': {
    confirm:  { to: '確認中', label: '確認受理', roles: ['staff'], tone: 'primary' },
    arrive:   { to: '已到貨', label: '標記到貨', roles: ['staff'], tone: 'neutral' },
    withdraw: { to: '草稿',   label: '撤回修改', roles: ['staff', 'editor'], tone: 'neutral' },
    cancel:   { to: '已取消', label: '取消訂單', roles: ['staff'], tone: 'danger' },
  },
  '確認中': {
    arrive: { to: '已到貨', label: '標記到貨', roles: ['staff'], tone: 'primary' },
    back:   { to: '已送出', label: '退回已送出', roles: ['staff'], tone: 'neutral' },
    cancel: { to: '已取消', label: '取消訂單', roles: ['staff'], tone: 'danger' },
  },
  '已到貨': {
    reopen: { to: '確認中', label: '改回確認中', roles: ['staff'], tone: 'neutral' },
  },
  '已取消': {
    restore: { to: '草稿', label: '恢復為草稿', roles: ['staff'], tone: 'neutral' },
  },
}

export const ORDER_STATUS_STYLE: Record<string, string> = {
  草稿:   'bg-stone-100 text-stone-600',
  已送出: 'bg-gold-50 text-gold-700',
  確認中: 'bg-amber-50 text-amber-700',
  已到貨: 'bg-emerald-50 text-emerald-700',
  已取消: 'bg-red-50 text-red-600',
}

export function orderActorOf(user: any): OrderActor {
  const staff = user?.role === 'admin' || user?.accountType === '行政' || user?.accountType === '中央管理'
  return staff ? 'staff' : 'editor'
}

/** 目前狀態下，這個角色能做的轉換 */
export function allowedOrderTransitions(status: string, actor: OrderActor) {
  return Object.entries(ORDER_TRANSITIONS[status] ?? {})
    .filter(([, t]) => t.roles.includes(actor))
    .map(([action, t]) => ({ action, ...t }))
}

/** 從 A 轉到 B 是否允許（依目標狀態找規則） */
export function findOrderTransition(from: string, to: string, actor: OrderActor) {
  return allowedOrderTransitions(from, actor).find((t) => t.to === to) ?? null
}

/** 內容（客戶、品項、條件）可否修改：業務只能改草稿；行政可改未取消的單（非草稿改品項需確認＋稽核） */
export function canEditOrderContent(status: string, actor: OrderActor) {
  if (actor === 'staff') return status !== '已取消'
  return status === '草稿'
}

/** 刪除：業務只能刪草稿；行政可刪任何狀態（建議改用「取消」保留紀錄） */
export function canDeleteOrder(status: string, actor: OrderActor) {
  return actor === 'staff' || status === '草稿'
}

export const PAYMENT_METHOD_PRESETS = ['月結', '貨到付款', '匯款', '刷卡', '現金']
export const DELIVERY_METHOD_PRESETS = ['宅配', '業務親送', '客戶自取', '貨運', '原廠直送']
