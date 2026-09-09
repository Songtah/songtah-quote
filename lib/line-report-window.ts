/**
 * 業務回報窗與業務日 —— 全系統唯一定義（CLAUDE.md 客情拜訪鐵則 1、2）。
 *
 * 回報窗＝台北時間 17:00～隔日 03:00。03:00–17:00 之間的訊息一律不當成日報，
 * 避免誤抓日間的閒聊與非回報內容。
 * 業務日 03:00 換日：凌晨 02:30 發的日報屬於「前一天」。
 *
 * 為什麼抽出來：webhook 用 event.timestamp 判斷，而 .txt 匯入用檔案裡的
 * 「日期＋時間」判斷，兩邊各自實作就會漂移——實際上匯入路徑根本沒做這道過濾，
 * 導致白天的訊息只要長得像日報就會被匯入。
 */

/** 回報窗起（含）與迄（不含），台北時 */
export const REPORT_WINDOW_START_HOUR = 17
export const REPORT_WINDOW_END_HOUR = 3

/** 台北時的「小時」是否落在回報窗內 */
export function isInReportWindowHour(twHour: number): boolean {
  return twHour >= REPORT_WINDOW_START_HOUR || twHour < REPORT_WINDOW_END_HOUR
}

/** 由 epoch 毫秒判斷（LINE webhook 用 event.timestamp） */
export function isInReportWindow(epochMs: number): boolean {
  return isInReportWindowHour(new Date(epochMs + 8 * 3600_000).getUTCHours())
}

/** 由 "HH:MM" 判斷（.txt 匯入用；檔案時間本來就是台北時，不需再位移） */
export function isInReportWindowTime(time: string): boolean {
  const hour = Number((time ?? '').split(':')[0])
  return Number.isFinite(hour) && isInReportWindowHour(hour)
}

/**
 * 訊息當下的日期時間 → 所屬業務日（03:00 前算前一天）。
 * date 為 'YYYY-MM-DD'、time 為 'HH:MM'（皆台北時）。
 */
export function businessDayOf(date: string, time: string): string {
  const hour = Number((time ?? '').split(':')[0])
  if (!date) return ''
  if (!Number.isFinite(hour) || hour >= REPORT_WINDOW_END_HOUR) return date
  const [y, m, d] = date.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d))
  prev.setUTCDate(prev.getUTCDate() - 1)
  return prev.toISOString().slice(0, 10)
}

export const REPORT_WINDOW_LABEL = '17:00～隔日 03:00'
