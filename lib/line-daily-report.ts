/**
 * 解析業務每日報表格式的 LINE 訊息
 *
 * 格式範例：
 *   每日報表
 *   職稱：南區業務
 *   日期：2026/06/05（五）
 *   ——————————————
 *   行程回報：
 *
 *   1.國雄牙醫診所
 *   。無口掃機
 *   。有詢問 ko-max 價格
 *
 *   2.多森牙醫診所
 *   。無技工室
 */

export type DailyReportVisit = {
  customerName: string
  notes: string[]    // 原始條列內容
  content: string    // 整合後的拜訪內容
  customerReaction: string
  needsFollowUp: boolean
}

export type DailyReport = {
  date: string       // YYYY-MM-DD
  title: string      // 職稱
  visits: DailyReportVisit[]
}

// ── 判斷是否為每日報表訊息 ────────────────────────────────────────────────────

export function isDailyReport(text: string): boolean {
  return text.includes('每日報表') && text.includes('行程回報')
}

// ── 解析報表 ──────────────────────────────────────────────────────────────────

export function parseDailyReport(text: string): DailyReport | null {
  if (!isDailyReport(text)) return null

  const lines = text.split('\n')

  // 日期：2026/06/05（五）
  let date = new Date().toISOString().split('T')[0]
  const dateLine = lines.find((l) => l.startsWith('日期：') || l.startsWith('日期:'))
  if (dateLine) {
    const m = dateLine.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)
    if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }

  // 職稱：南區業務（非業務角色直接跳過）
  const titleLine = lines.find((l) => l.startsWith('職稱：') || l.startsWith('職稱:'))
  const title = titleLine?.replace(/職稱[：:]/, '').trim() ?? ''
  if (title && !title.includes('業務')) return null

  // 取「行程回報：」之後的內容
  const bodyIdx = lines.findIndex((l) => l.includes('行程回報'))
  if (bodyIdx === -1) return null
  const bodyLines = lines.slice(bodyIdx + 1)

  // 解析編號條目
  const visits: DailyReportVisit[] = []
  let currentName = ''
  let currentNotes: string[] = []

  function flush() {
    if (!currentName || isNonVisitEntry(currentName)) return
    const notes = currentNotes
    visits.push({
      customerName: currentName,
      notes,
      content: notes.join('\n'),
      customerReaction: inferReaction(notes),
      needsFollowUp: inferFollowUp(notes),
    })
  }

  for (const line of bodyLines) {
    const t = line.trim()
    if (!t) continue

    // 編號行：1.客戶名稱 or 1．客戶名稱
    const numMatch = t.match(/^(\d+)[\.．](.+)/)
    if (numMatch) {
      flush()
      currentName = numMatch[2].trim()
      currentNotes = []
      continue
    }

    // 條列：。內容
    if (t.startsWith('。') || t.startsWith('·') || t.startsWith('•')) {
      const note = t.replace(/^[。·•]\s*/, '').trim()
      if (note) currentNotes.push(note)
    }
  }
  flush()

  return { date, title, visits }
}

// ── 跳過非拜訪項目 ────────────────────────────────────────────────────────────

const NON_VISIT_KEYWORDS = ['業務會議', '內部會議', '公司會議', '培訓', '教育訓練', '開會']

function isNonVisitEntry(name: string): boolean {
  return NON_VISIT_KEYWORDS.some((kw) => name.includes(kw))
}

// ── 從條列內容推斷客戶反應 ────────────────────────────────────────────────────

function inferReaction(notes: string[]): string {
  const text = notes.join(' ')
  if (/訂購|下單|成交/.test(text)) return '積極配合'
  if (/有詢問|有興趣|感興趣|詢問價格|要報價/.test(text)) return '有興趣'
  if (/不確定|考慮|再看看|等等看/.test(text)) return '需考慮'
  if (/不需要|拒絕|不考慮|暫不|已有/.test(text)) return '暫不需要'
  return ''
}

// ── 從條列內容推斷是否需追蹤 ─────────────────────────────────────────────────

function inferFollowUp(notes: string[]): boolean {
  const text = notes.join(' ')
  return /後續|跟進|追蹤|回覆|確認|再聯絡|回報|待定|討論/.test(text)
}
