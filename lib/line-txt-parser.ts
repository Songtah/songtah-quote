/**
 * 解析 LINE 群組聊天記錄 .txt 匯出檔案
 *
 * LINE 匯出格式（iOS，繁體中文）：
 *   [LINE] 「群組名稱」的聊天記錄
 *   儲存日期：2024/01/15 14:30
 *
 *   2024/01/15(一)
 *   下午 02:30	林業務	訊息內容
 *
 * 每則訊息以 Tab 分隔：時間\t發送人\t內容
 */

export type LineMessage = {
  date: string    // YYYY-MM-DD
  time: string    // HH:MM
  sender: string
  text: string
}

// 日期標題：2024/01/15(一) 或 2024/01/15
const DATE_HEADER_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\(.\))?$/

// 訊息行（tab 分隔）：[上午|下午] H:MM\t發送人\t內容
// 或：H:MM AM/PM\t發送人\t內容
const MSG_TAB_RE = /^(?:(上午|下午)\s?)?(\d{1,2}:\d{2})(?::\d{2})?\s*(?:(AM|PM)\s?)?\t(.+?)\t(.+)$/i

export function parseLineTxt(content: string): LineMessage[] {
  const messages: LineMessage[] = []
  const lines = content.split('\n').map((l) => l.trimEnd())

  let currentDate = ''

  for (const line of lines) {
    // 日期標題
    const dateM = line.match(DATE_HEADER_RE)
    if (dateM) {
      const [, y, m, d] = dateM
      currentDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      continue
    }

    if (!currentDate) continue

    // 訊息行
    const msgM = line.match(MSG_TAB_RE)
    if (!msgM) continue

    const [, period, timeStr, ampm, sender, text] = msgM
    let [h, min] = timeStr.split(':').map(Number)

    // 處理中文上午/下午
    if (period === '下午' && h < 12) h += 12
    if (period === '上午' && h === 12) h = 0

    // 處理英文 AM/PM
    if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12
    if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0

    // 跳過系統訊息（LINE 自動產生）
    const trimmedSender = sender.trim()
    if (trimmedSender === '' || trimmedSender === 'LINE') continue

    messages.push({
      date: currentDate,
      time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      sender: trimmedSender,
      text: text.trim(),
    })
  }

  return messages
}
