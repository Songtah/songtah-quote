/**
 * 解析 Slack「業務開發-討論區」頻道裡的跨區支援報備文字訊息。
 * 比照 lib/line-daily-report.ts 的做法(自由文字打標籤 → 解析),而非結構化表單。
 *
 * 格式(第一行固定標記,其餘欄位不限順序):
 *   跨區支援
 *   業務：Sam
 *   客戶：OO牙醫診所
 *   縣市：桃園市
 *   日期：2026/08/14
 *   事由：協助處理設備報價
 */

export type CrossSupportMessage = {
  salesperson: string
  customerName: string
  city: string
  supportDate: string
  reason: string
}

export function isCrossSupportReport(text: string): boolean {
  return /跨區支援/.test(text)
}

function getField(text: string, label: string): string {
  const m = text.match(new RegExp(`${label}[：:]\\s*(.+)`))
  return m ? m[1].trim() : ''
}

function normalizeDate(raw: string): string {
  const m = raw.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // 沒填日期 → 預設今天(台北業務日,回報窗跨凌晨,03:00 前算前一天,比照 LINE 日報)
  return new Date(Date.now() + 8 * 3600_000 - 3 * 3600_000).toISOString().slice(0, 10)
}

export function parseCrossSupportMessage(rawText: string): CrossSupportMessage | null {
  // 有些人會習慣把整段包進程式碼區塊(```...```)貼,先拆掉避免污染最後一個欄位。
  const text = rawText.replace(/^```|```$/g, '').trim()
  if (!isCrossSupportReport(text)) return null

  const salesperson = getField(text, '業務')
  const customerName = getField(text, '客戶')
  if (!salesperson || !customerName) return null

  return {
    salesperson,
    customerName,
    city: getField(text, '縣市'),
    supportDate: normalizeDate(getField(text, '日期')),
    reason: getField(text, '事由'),
  }
}
