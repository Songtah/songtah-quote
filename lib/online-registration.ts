/**
 * lib/online-registration.ts —— 線上課程報名頁的開放規則與金額（純函式，公開頁與 API 共用）
 *
 * 一個活動＝一個報名頁：/register/[活動 id]。活動管理頁設定「線上報名、收費、報名費、付款說明、廣告圖、名額」。
 * 報名寫入活動報名 DB（來源＝報名表單），客戶配對沿用每小時的 processRegistrations，業務不需處理。
 */

export type RegistrationGate = { open: boolean; reason: string; seatsLeft: number | null }

const todayTW = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

/**
 * 是否接受報名。依序：線上報名開關 → 活動狀態 → 截止日 → 活動日已過 → 名額。
 * 「籌備中」也允許報名：常見做法是先開報名再定細節；只有「已結束」關閉。
 */
export function registrationGate(
  event: { onlineRegistration: boolean; status: string; deadline: string; date: string; endDate: string; capacity: number },
  seatsTaken: number,
  today = todayTW(),
): RegistrationGate {
  const seatsLeft = event.capacity > 0 ? Math.max(event.capacity - seatsTaken, 0) : null
  if (!event.onlineRegistration) return { open: false, reason: '此活動未開放線上報名', seatsLeft }
  if (event.status === '已結束') return { open: false, reason: '此活動已結束', seatsLeft }
  if (event.deadline && today > event.deadline.slice(0, 10)) return { open: false, reason: '報名已截止', seatsLeft }
  const lastDay = (event.endDate || event.date || '').slice(0, 10)
  if (lastDay && today > lastDay) return { open: false, reason: '此活動已結束', seatsLeft }
  if (seatsLeft === 0) return { open: false, reason: '名額已滿', seatsLeft }
  return { open: true, reason: '', seatsLeft }
}

/** 每筆報名最多幾位（同單位多人一起報名） */
export const MAX_ATTENDEES_PER_SIGNUP = 10

export function registrationAmount(event: { paid: boolean; fee: number }, attendees: number): number {
  return event.paid && event.fee > 0 ? event.fee * attendees : 0
}

export const JOB_TITLES = ['牙醫師', '牙體技術師', '牙體技術生', '助理', '學生', '其他'] as const

/**
 * 報名方案（2026-10-27 整合 SurveyCake 報名表）：一個活動可設多個方案，例「台北場單人 NT$15,000」「雙人 NT$28,000」。
 * 方案決定金額與人數（people＝這個方案含幾位）；活動沒設方案時沿用「報名費 × 人數」。
 * 存在活動 DB「報名方案」文字欄（JSON），伺服器以方案序號重算金額，不採用前端送來的數字。
 */
export type RegistrationPlan = { name: string; price: number; people: number }
export const MAX_PLANS = 10

/** 方案 JSON → 驗證過的方案清單；格式錯誤的項目略過 */
export function parsePlans(raw: unknown): RegistrationPlan[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try { list = raw.trim() ? JSON.parse(raw) : [] } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list.flatMap((p: any) => {
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : ''
    const price = Math.round(Number(p?.price))
    const people = Math.floor(Number(p?.people))
    if (!name || !Number.isFinite(price) || price < 0 || price > 1_000_000) return []
    if (!Number.isFinite(people) || people < 1 || people > MAX_ATTENDEES_PER_SIGNUP) return []
    return [{ name, price, people }]
  }).slice(0, MAX_PLANS)
}

export const GENDERS = ['男', '女'] as const
export const DIETS = ['不限', '不吃牛', '蛋奶素', '其他'] as const
export const INFO_SOURCES = ['臉書粉絲團', 'LINE 官方帳號', '業務介紹', '其他'] as const
export const PAYMENT_METHODS = ['匯款', '現金交業務'] as const

export const formatNT = (n: number) => `NT$ ${n.toLocaleString('zh-TW')}`
