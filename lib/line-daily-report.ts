/**
 * 解析業務每日行程回報格式（LINE 訊息）
 *
 * 支援的格式變體：
 *   A) 有「每日報表」header（較新格式）
 *   B) 直接「職稱：業務/中區」+ 「✅行程回報：」（舊格式）
 *
 * 客戶條目格式：
 *   1.診所名稱\n。備註         ← 名稱獨立一行，備註另起
 *   1.客戶-內容                ← 名稱與內容用 - 分隔
 *   1.客戶，內容               ← 名稱與內容用 ， 分隔
 */

export type DailyReportVisit = {
  customerName: string
  notes: string[]
  content: string
  customerReaction: string
  needsFollowUp: boolean
}

export type DailyReport = {
  date: string       // YYYY-MM-DD
  title: string      // 職稱
  visits: DailyReportVisit[]
}

// ── 判斷是否為行程回報訊息 ────────────────────────────────────────────────────

export function isDailyReport(text: string): boolean {
  const hasReport = /行程回報/.test(text)
  const hasIdentifier = /職稱|每日報表/.test(text)
  return hasReport && hasIdentifier
}

// ── 解析報表 ──────────────────────────────────────────────────────────────────

export function parseDailyReport(text: string): DailyReport | null {
  if (!isDailyReport(text)) return null

  const lines = text.split('\n')

  // ── 日期：多種格式 ─────────────────────────────────────────────────────────
  // 日期： 2025 / 01 / 08（三）  日期：2026/06/05（五）  日期: 2025/01/08
  // 預設日期 = 台灣「業務日」：回報窗 17:00～隔日 03:00，
  // 凌晨 03:00 前發的訊息歸前一天（UTC+8 再減 3 小時取日期）。
  let date = new Date(Date.now() + 8 * 3600_000 - 3 * 3600_000).toISOString().split('T')[0]
  const dateLine = lines.find((l) => /日期[：:]/.test(l))
  if (dateLine) {
    const m = dateLine.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/)
    if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }

  // ── 職稱：僅保留供顯示，不再用來過濾 ───────────────────────────────────────
  // 角色過濾改由呼叫端以「發送人是否在業務名單」判斷（isKnownSalesperson），
  // 避免業務職稱寫法不一（如未寫「業務」二字）導致整則日報被丟棄。
  const titleLine = lines.find((l) => /職稱[：:\s]/.test(l) || l.startsWith('職稱'))
  const title = titleLine?.replace(/職稱[：:\s]*/, '').trim() ?? ''

  // ── 找行程回報區塊 ─────────────────────────────────────────────────────────
  const bodyIdx = lines.findIndex((l) => /行程回報/.test(l))
  if (bodyIdx === -1) return null
  const bodyLines = lines.slice(bodyIdx + 1)

  // ── 解析客戶條目 ──────────────────────────────────────────────────────────
  const visits: DailyReportVisit[] = []
  let currentName = ''
  let currentNotes: string[] = []

  function flush() {
    if (!currentName || isNonVisitEntry(currentName)) return
    visits.push({
      customerName: currentName,
      notes: currentNotes,
      content: currentNotes.join('\n'),
      customerReaction: inferReaction(currentNotes),
      needsFollowUp: inferFollowUp(currentNotes),
    })
  }

  for (const line of bodyLines) {
    const t = line.trim()
    if (!t) continue

    // 跳過區段標記（[上午] [下午] 「上午] 等）
    if (/^[「\[【]?(上午|下午)[」\]】]?[：:]?$/.test(t)) continue

    // 編號條目：1.名稱 / 1．名稱 / 1、名稱 / 1)名稱 / 全形數字１２３
    // 分隔符後可有空白；支援半形與全形數字，涵蓋各業務不同的編號寫法。
    const numMatch = t.match(/^([0-9０-９]+)[\.．、)）:：]\s*(.+)/)
    if (numMatch) {
      flush()
      const rest = numMatch[2].trim()
      const { name, inlineContent } = extractNameAndContent(rest)
      currentName = name
      currentNotes = inlineContent ? [inlineContent] : []
      continue
    }

    // 條列備註：。內容 或 · 內容
    if (t.startsWith('。') || t.startsWith('·') || t.startsWith('•')) {
      const note = t.replace(/^[。·•]\s*/, '').trim()
      if (note) currentNotes.push(note)
      continue
    }

    // 無編號、非條列 → 若有 currentName 則當附加備註
    if (currentName) {
      currentNotes.push(t)
    }
  }
  flush()

  return { date, title, visits }
}

// ── 從「名稱-內容」或「名稱，內容」中拆出名稱與內容 ──────────────────────────

function extractNameAndContent(rest: string): { name: string; inlineContent: string } {
  // 先試 -（Dash）分隔：名稱通常 ≤ 8 字
  const dashIdx = rest.indexOf('-')
  if (dashIdx > 0 && dashIdx <= 10) {
    return {
      name: rest.slice(0, dashIdx).trim(),
      inlineContent: rest.slice(dashIdx + 1).trim(),
    }
  }

  // 再試 ，分隔：名稱通常 ≤ 6 字
  const commaIdx = rest.indexOf('，')
  if (commaIdx > 0 && commaIdx <= 8) {
    return {
      name: rest.slice(0, commaIdx).trim(),
      inlineContent: rest.slice(commaIdx + 1).trim(),
    }
  }

  // 找不到分隔符 → 整行是名稱，內容在後續條列
  return { name: rest, inlineContent: '' }
}

// ── 跳過非拜訪項目 ────────────────────────────────────────────────────────────

const NON_VISIT_KEYWORDS = [
  '業務會議', '內部會議', '公司會議', '培訓', '教育訓練', '開會', '進公司',
  '例行會議', '週一會議', '週一例行', '局寄貨', '銀行',
]

// 明顯的任務描述動詞開頭（不是客戶名稱）
const TASK_VERB_PREFIXES = [
  '致電', '通知', '整理', '前往', '協助', '遠端', '預約', '邀約',
  '推薦客戶', '整理公司', '與小胖', '與Julian', '與Aaron',
  '9:', '19:', '08:', '10:', '11:', '12:', '13:', '14:', '15:', '16:', '17:', '18:',
]

function isNonVisitEntry(name: string): boolean {
  // 關鍵字比對
  if (NON_VISIT_KEYWORDS.some((kw) => name.includes(kw))) return true
  // 任務動詞開頭
  if (TASK_VERB_PREFIXES.some((p) => name.startsWith(p))) return true
  // 名稱含 & 代表是多任務描述，不是客戶
  if (name.includes('&')) return true
  // 名稱超長（>15字）且不含任何分隔符 → 可能是整段任務描述
  if (name.length > 15 && !/[-，,]/.test(name)) return true
  return false
}

// ── 推斷客戶反應 ──────────────────────────────────────────────────────────────

function inferReaction(notes: string[]): string {
  const text = notes.join(' ')
  if (/訂購|下單|成交|購買|訂貨/.test(text)) return '積極配合'
  if (/有詢問|有興趣|感興趣|詢問價格|要報價|詢問/.test(text)) return '有興趣'
  if (/不確定|考慮|再看看|等等看|討論/.test(text)) return '需考慮'
  if (/不需要|拒絕|不考慮|暫不|已有/.test(text)) return '暫不需要'
  return ''
}

// ── 推斷是否需追蹤 ────────────────────────────────────────────────────────────

function inferFollowUp(notes: string[]): boolean {
  const text = notes.join(' ')
  return /後續|跟進|追蹤|回覆|確認|再聯絡|回報|待定|協助|聯繫/.test(text)
}
