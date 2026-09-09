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
  /** 依內容推斷的下次追蹤日（YYYY-MM-DD）；需追蹤但沒講時間就用預設間隔 */
  nextFollowUpDate: string
}

export type DailyReport = {
  date: string       // YYYY-MM-DD
  title: string      // 職稱
  visits: DailyReportVisit[]
}

// ── 判斷是否為行程回報訊息 ────────────────────────────────────────────────────

export function isDailyReport(text: string): boolean {
  // 認得兩種開頭標記：「行程回報」(舊格式) 或「每日報表」(如 Eason 直接條列、無行程回報字樣)。
  // 純晨間「行程規劃」會在 parseDailyReport 內被濾掉，這裡先寬鬆放行。
  return /行程回報|每日報表/.test(text)
}

// ── 解析報表 ──────────────────────────────────────────────────────────────────

export function parseDailyReport(text: string, fallbackDate?: string): DailyReport | null {
  if (!isDailyReport(text)) return null

  const lines = text.split('\n')

  // ── 日期：多種格式 ─────────────────────────────────────────────────────────
  // 日期： 2025 / 01 / 08（三）  日期：2026/06/05（五）  日期: 2025/01/08
  // 預設日期 = 台灣「業務日」：回報窗 17:00～隔日 03:00，
  // 凌晨 03:00 前發的訊息歸前一天（UTC+8 再減 3 小時取日期）。
  // fallbackDate 由呼叫端給（.txt 匯入時＝該訊息所屬業務日）。
  // 沒給才退回「現在的業務日」——匯入歷史檔案時若少了這個參數，
  // 所有沒寫「日期：」的日報都會被標成今天。
  let date = fallbackDate
    || new Date(Date.now() + 8 * 3600_000 - 3 * 3600_000).toISOString().split('T')[0]
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

  // ── 找客戶清單區塊 ─────────────────────────────────────────────────────────
  // 1) 有「行程回報」→ 從它之後開始（排除上方的晨間「行程規劃」）
  // 2) 沒回報但有「行程規劃」→ 純晨間規劃，不匯入
  // 3) 兩者皆無（如 Eason：每日報表→職稱→日期→條列）→ 整則皆為條目，
  //    迴圈會自動略過 header 行（每日報表/職稱/日期/分隔線），從第一個編號條目開始
  const bodyIdx = lines.findIndex((l) => /行程回報/.test(l))
  let bodyLines: string[]
  if (bodyIdx !== -1) {
    bodyLines = lines.slice(bodyIdx + 1)
  } else if (lines.some((l) => /行程規劃/.test(l))) {
    return null
  } else {
    bodyLines = lines
  }

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
      needsFollowUp: inferFollowUp(currentNotes, date),
      nextFollowUpDate: inferNextFollowUpDate(currentNotes, date),
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

// 回傳值**必須**是 Notion「客戶反應」select 的實際選項名稱。
// 原本回傳「積極配合／有興趣／需考慮／暫不需要」,這四個沒有一個在選項清單裡,
// 於是 webhook 的 formOptions.customerReactions.includes() 永遠 false、一律清空——
// 實測 5,068 筆有客戶關聯的拜訪只有 149 筆有反應值,其餘全是這個對不上造成的靜默失效。
// 規則由強到弱排列,先命中者優先。
const REACTION_RULES: { pattern: RegExp; value: string }[] = [
  { pattern: /訂購|下單|成交|購買|訂貨|要了|確認數量/,      value: '確認下單' },
  { pattern: /報價|估價/,                                  value: '要求報價' },
  { pattern: /試用|試機|試作|留給.*試|放.*試/,              value: '同意試用' },
  { pattern: /太貴|價格高|價格有疑慮|嫌貴|價錢.*高/,         value: '價格有疑慮' },
  { pattern: /競品|對手|別家|他牌|其他品牌/,                value: '使用競品' },
  { pattern: /再訪|下次再來|安排.*拜訪|約.*再來/,           value: '安排再次拜訪' },
  { pattern: /很有興趣|積極|主動詢問|一直問/,               value: '積極詢問' },
  { pattern: /有興趣|感興趣|有詢問|詢問/,                   value: '有興趣待確認' },
  { pattern: /不需要|拒絕|不考慮|暫不|已有|沒需求|用不到/,   value: '近期無需求' },
  { pattern: /冷淡|沒反應|不太理/,                          value: '反應冷淡' },
  { pattern: /不確定|考慮|再看看|等等看|討論|觀望/,          value: '持觀望態度' },
]

function inferReaction(notes: string[]): string {
  const text = notes.join(' ')
  for (const rule of REACTION_RULES) if (rule.pattern.test(text)) return rule.value
  return ''
}

/**
 * 客戶反應 → 該推進到哪個開發階段。
 *
 * 依 CLAUDE.md 最高原則：業務只回報客情紀錄，漏斗要由系統自己推進。
 * 原本只有「在系統裡手動新增客情」與「開報價」會推進階段，LINE 回報完全不會——
 * 而業務幾乎都用 LINE，所以 5,891 筆拜訪換來 0 筆「已接觸」，漏斗形同虛設。
 *
 * 「已成交」刻意不由口頭反應決定：成交以實際訂單為準（見 campaign-autoclose）。
 */
export function devStageForReaction(reaction: string): '已接觸' | '試用中' | '報價中' {
  if (reaction === '同意試用') return '試用中'
  if (reaction === '要求報價' || reaction === '價格有疑慮' || reaction === '確認下單') return '報價中'
  return '已接觸'   // 有客戶關聯的拜訪本身就代表已接觸
}

// ── 推斷是否需追蹤與下次追蹤日 ────────────────────────────────────────────────
//
// 兩件事綁在一起判斷:**講了時間就是有後續**。原本 inferFollowUp 只認關鍵字,
// 會漏掉「明天再帶樣品過去」「三個月後再拜訪」「下個月預算下來再談」這類明確承諾。
//
// 為什麼要自動推斷日期:沒有到期日就沒有「逾期」可言。實測 5,891 筆客情紀錄裡
// 「下次追蹤日」只有 2 筆有填(0.03%)——從來沒有人手動填,解析器也不曾寫入。
// 依 CLAUDE.md 自動化鐵則,填答率趨近 0 的欄位要改成自動填,不是要求業務加強填寫。

/** 需追蹤但內容沒提到任何時間時的預設間隔（天） */
export const DEFAULT_FOLLOW_UP_DAYS = 14

const FOLLOW_UP_KEYWORDS = /後續|跟進|追蹤|回覆|確認|再聯絡|回報|待定|協助|聯繫/

/** 相對時間說法 → 天數。由近到遠排列，先命中者優先（講「下週」不會被「一個月」蓋過）。 */
const RELATIVE_RULES: { pattern: RegExp; days: number }[] = [
  { pattern: /明天|隔天|明日/,                        days: 1 },
  { pattern: /後天/,                                 days: 2 },
  { pattern: /這週|本週|這周|本周|週末|周末|這禮拜/,    days: 3 },
  { pattern: /下週|下周|下禮拜|下星期|一週後|一周後/,   days: 7 },
  { pattern: /兩週|兩周|２週|2週|2周|下下週|下下周/,    days: 14 },
  { pattern: /月底|這個月底|本月底/,                   days: 21 },
  // 多月份的寫法要排在「下個月」之前，否則「三個月後」會被 /個月/ 先吃掉
  { pattern: /半年|六個月|6個月/,                     days: 180 },
  { pattern: /三個月|3個月|一季|下一季|下季/,           days: 90 },
  { pattern: /兩個月|2個月/,                          days: 60 },
  { pattern: /下個月|下月|一個月|1個月/,               days: 30 },
]

/** 「10月初/月中/月底」這種沒有明確日號的寫法，取該旬的代表日 */
const MONTH_PART: { pattern: RegExp; day: number }[] = [
  { pattern: /初/, day: 5 }, { pattern: /中/, day: 15 }, { pattern: /底|末/, day: 25 },
]

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** 講的月日若已早於拜訪日，視為明年（跨年報表常見） */
function pinToFuture(visitDate: string, month: number, day: number): string {
  const year = Number(visitDate.slice(0, 4))
  const mk = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return mk(year) >= visitDate ? mk(year) : mk(year + 1)
}

/**
 * 承諾詞。單純提到日期不算後續——實測「分享 10/18 課程資訊」這種內容裡的日期
 * 會被誤當成追蹤日，把需追蹤筆數從 700 灌到 1,928。
 * 要「時間 ＋ 承諾」同時出現才算，例如「明天**再**帶樣品」「下個月預算下來**再**談」。
 */
const COMMITMENT = /再|會|預計|等|要|後續|約|排/

/** 從內容抓出時間承諾；抓不到回 null。 */
function detectTimeHint(text: string, visitDate: string): string | null {
  // 明確月日：10/18、10月18日
  const explicit = text.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})/)
  if (explicit) {
    const month = Number(explicit[1]), day = Number(explicit[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return pinToFuture(visitDate, month, day)
  }
  // 月初/月中/月底：10月初
  const part = text.match(/(\d{1,2})\s*月\s*([初中底末])/)
  if (part) {
    const month = Number(part[1])
    const hit = MONTH_PART.find((r) => r.pattern.test(part[2]))
    if (month >= 1 && month <= 12 && hit) return pinToFuture(visitDate, month, hit.day)
  }
  for (const rule of RELATIVE_RULES) {
    if (rule.pattern.test(text)) return addDays(visitDate, rule.days)
  }
  return null
}

function inferFollowUp(notes: string[], visitDate: string): boolean {
  const text = notes.join(' ')
  if (FOLLOW_UP_KEYWORDS.test(text)) return true
  // 時間必須搭配承諾詞，單純提到日期（課程日、交機日）不算要追蹤
  return detectTimeHint(text, visitDate) !== null && COMMITMENT.test(text)
}

export function inferNextFollowUpDate(notes: string[], visitDate: string): string {
  if (!visitDate || !inferFollowUp(notes, visitDate)) return ''
  return detectTimeHint(notes.join(' '), visitDate) || addDays(visitDate, DEFAULT_FOLLOW_UP_DAYS)
}
