/**
 * lib/notification-events.ts —— 哪些事要通知誰（組合層：各業務流程在狀態改變處呼叫這裡）
 *
 * 通知機制本身在 lib/notifications.ts。這裡只決定「事件 → 頻道、文字、連結、何時收掉」。
 * 需要處理的事帶 resolveKey，處理完由對應流程呼叫 resolve，通知自動消失，不要求人回來點。
 * 背景送出（waitUntil）：通知失敗或變慢都不影響原本的存檔回應。
 */
import 'server-only'
import { waitUntil } from '@vercel/functions'
import { notify, resolveNotifications } from '@/lib/notifications'

/** 主管：中央管理、總經理、系統管理員（2026-10-28 使用者：客情監控的更新主管也要收到） */
const MANAGERS = ['t:中央管理', 't:總經理', 'r:admin']
/** 行政（訂單受理、報名處理）：與 lib/order-status orderActorOf 的 staff 一致 */
const STAFF = ['t:行政', 't:中央管理', 'r:admin']
const QUOTE_REVIEWERS = ['t:行政', 'r:admin']        // lib/quote-status：待行政審核由 admin／行政簽核
const QUOTE_GM = ['t:總經理', 'r:admin']             // 待總經理審核由總經理／admin 簽核

const person = (name?: string) => (name?.trim() ? [`n:${name.trim()}`] : [])
const bg = (p: Promise<unknown>) => { try { waitUntil(p) } catch { void p } }

// ── 活動問卷／滿意度調查 ─────────────────────────────────
/** 有人填了問卷：通知中央管理與系統管理員（2026-11-14 使用者指示）。純通知，不需處理 */
const FORM_WATCHERS = ['t:中央管理', 'r:admin']
export function formResponseReceived(f: { eventId: string; eventName: string; kindLabel: string; name: string; institution: string; jobTitle: string }) {
  const who = [f.name, f.jobTitle].filter(Boolean).join(' ') || '匿名填寫者'
  bg(notify(FORM_WATCHERS, {
    title: `${f.kindLabel}有新回覆`,
    body: `${who}${f.institution ? `（${f.institution}）` : ''}填了${f.eventName ? `「${f.eventName}」的` : ''}${f.kindLabel}`,
    href: `/events/${f.eventId}`,
  }))
}

// ── 報價單 ───────────────────────────────────────────────
export function quoteStatusChanged(q: { id: string; quoteNumber: string; customerName: string; salesperson: string }, to: string) {
  const who = [q.customerName, q.salesperson].filter(Boolean).join('・')
  const href = `/quote/${q.id}`
  bg((async () => {
    if (to === '待行政審核') {
      await notify(QUOTE_REVIEWERS, { title: '報價單待審核', body: `${q.quoteNumber}　${who}`, href, resolveKey: `quote-review:${q.id}` })
      return
    }
    await resolveNotifications(`quote-review:${q.id}`)
    if (to === '待總經理審核') {
      await notify(QUOTE_GM, { title: '報價單待總經理審核', body: `${q.quoteNumber}　${who}`, href, resolveKey: `quote-gm:${q.id}` })
      return
    }
    await resolveNotifications(`quote-gm:${q.id}`)
    if (to === '已核准' || to === '已退回') {
      await notify(person(q.salesperson), {
        title: to === '已核准' ? '報價單已核准' : '報價單被退回',
        body: `${q.quoteNumber}　${q.customerName}${to === '已核准' ? '，可以下載 PDF 給客戶了' : '，請看退回原因後修改'}`,
        href,
      })
    }
  })())
}

// ── 訂貨單 ───────────────────────────────────────────────
export function orderStatusChanged(o: { id: string; orderNumber: string; customerName: string; salesperson: string }, to: string) {
  bg((async () => {
    if (to === '已送出') {
      await notify(STAFF, {
        title: '新訂貨單待受理', body: `${o.orderNumber}　${[o.customerName, o.salesperson].filter(Boolean).join('・')}`,
        href: `/orders/${o.id}`, resolveKey: `order-confirm:${o.id}`,
      })
    } else {
      await resolveNotifications(`order-confirm:${o.id}`)
    }
  })())
}

// ── 線上報名 ─────────────────────────────────────────────
export function registrationCreated(e: { id: string; name: string }, r: { institution: string; contact: string; attendees: number; amount: number; transferLast5?: string }) {
  const pay = r.amount > 0 ? `，應繳 NT$ ${r.amount.toLocaleString('zh-TW')}${r.transferLast5 ? `（後五碼 ${r.transferLast5}）` : ''}` : ''
  bg(notify(STAFF, {
    title: `新報名：${e.name}`,
    body: `${r.institution}・${r.contact}　${r.attendees} 位${pay}`,
    href: `/events/${e.id}`,
  }))
}

// ── LINE 日報 ────────────────────────────────────────────
/** 日報重試到上限仍沒建檔成功：以前只寫在伺服器紀錄裡沒人知道，客情就這樣漏掉。通知主管與回報的業務 */
export function lineReportFailed(r: { salesperson: string; date: string; error: string }) {
  bg(notify([...MANAGERS, ...person(r.salesperson)], {
    title: 'LINE 日報沒有成功入庫',
    body: `${r.salesperson} ${r.date} 的日報重試多次仍失敗（${r.error.slice(0, 80) || '原因不明'}）。請到「LINE 日報匯入」補匯，或請業務重傳`,
    href: '/admin/line-import',
  }))
}

// ── 客情監控（客情自動判讀後的系統動作）：回報的業務＋主管 ─────────────
export function repairTicketCreated(t: { id: string; number: string; customerName: string; summary: string; salesperson: string }) {
  bg(notify([...MANAGERS, ...person(t.salesperson)], {
    title: `新維修工單 ${t.number}（待指派）`,
    body: `${t.customerName}　${t.summary}`,
    href: `/tickets/${t.id}`,
  }))
}

export function visitClosureApplied(c: { customerId: string; customerName: string; to: string; reporter: string; visitDate: string }) {
  bg(notify([...MANAGERS, ...person(c.reporter)], {
    title: '客情偵測：機構已歇業',
    body: `${c.customerName} 機構狀態改為「${c.to}」（${c.reporter} ${c.visitDate} 回報）。誤判可在醫事監控頁一鍵復原`,
    href: '/admin/clinic-monitor',
  }))
}

// ── 價格異動公告（每月 1 日）：所有內部帳號 ─────────────────────
const EVERYONE = ['t:業務', 't:行政', 't:中央管理', 't:總經理', 't:技術支援', 't:財務', 'r:admin']
export function priceAnnouncementPublished(a: { period: string; total: number; summary: string }) {
  bg(notify(EVERYONE, {
    title: `${a.period.replace('-', ' 年 ')} 月價格異動公告`,
    body: `共 ${a.total} 個品項：${a.summary}`,
    href: `/products/pricing?tab=announcements&period=${a.period}`,
  }))
}
