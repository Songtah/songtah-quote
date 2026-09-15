/**
 * lib/event-import.ts —— 歷史活動參與紀錄匯入：解析與正規化（純函式，前後端共用）
 *
 * 來源通常是行政手上的 Excel：直接複製貼上（Tab 分隔）或另存 CSV 上傳。
 * 欄位名稱各場不一，用別名表對應；一份檔案可以是「多場課程混在一起」（每列有課程名稱與日期），
 * 也可以是「單一課程的名單」（沒有課程欄，由畫面上統一指定）。
 */

export type ImportRow = {
  eventName: string
  eventDate: string     // YYYY-MM-DD
  eventType: string
  institution: string
  contact: string
  phone: string
  email: string
  city: string
  status: string        // 已到場／已報名／取消
  attendees: number
}

export type ImportField = keyof ImportRow

export const EVENT_TYPES = ['研討會', '產品發表', '培訓', '展覽', '其他'] as const

/** 表頭別名（比對時去空白、全形括號、大小寫） */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  eventName:   ['活動名稱', '課程名稱', '課程', '活動', '場次', '課程主題', '主題'],
  eventDate:   ['活動日期', '課程日期', '上課日期', '日期', '場次日期', '開課日期'],
  eventType:   ['活動類型', '類型', '課程類型'],
  institution: ['機構名稱', '診所名稱', '單位名稱', '單位', '診所', '機構', '服務單位', '公司名稱', '技工所', '所屬單位', '任職單位'],
  contact:     ['姓名', '聯絡人', '學員姓名', '學員', '參加者', '報名人'],
  phone:       ['電話', '手機', '聯絡電話', '行動電話', '連絡電話', '手機號碼'],
  email:       ['信箱', 'email', 'e-mail', '電子郵件', '電子信箱'],
  city:        ['縣市', '地區', '所在縣市', '區域'],
  status:      ['狀態', '出席', '出席狀況', '是否出席', '報到', '簽到', '到場'],
  attendees:   ['人數', '參加人數', '報名人數'],
}

const normHeader = (s: string) => s.replace(/[\s（）()＊*:：]/g, '').toLowerCase()

export function detectColumns(headers: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {}
  const normalized = headers.map(normHeader)
  // 先精確、再包含，避免「活動」吃掉「活動日期」
  for (const pass of ['exact', 'contains'] as const) {
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
      if (out[field] !== undefined) continue
      const idx = normalized.findIndex((h, i) =>
        !Object.values(out).includes(i) &&
        aliases.some((a) => (pass === 'exact' ? h === normHeader(a) : h.includes(normHeader(a)))))
      if (idx >= 0) out[field] = idx
    }
  }
  return out
}

/** 解析 CSV 或 Tab 分隔（Excel 複製貼上），支援雙引號包住的逗號與換行 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const firstLine = src.split('\n', 1)[0] ?? ''
  const delim = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 2025/3/15、2025-03-15、114/3/15（民國）、2025年3月15日、Excel 序號 45731 → YYYY-MM-DD；無法解析回空字串 */
export function parseLooseDate(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400e3)
    return d.toISOString().slice(0, 10)
  }
  const m = s.match(/^(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/)
  if (!m) return ''
  let y = Number(m[1])
  if (y < 1000) y += 1911
  const mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ''
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return ''
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** 出席欄位 → 報名狀態；空白用畫面指定的預設值 */
export function normalizeStatus(raw: string, fallback: string): string {
  const s = (raw ?? '').replace(/\s/g, '')
  if (!s) return fallback
  if (/^(取消|未出席|缺席|沒來|未到|否|n|no|x|✗)$/i.test(s)) return '取消'
  if (/^(報名|已報名|待確認)$/.test(s)) return '已報名'
  if (/^(已確認|確認)$/.test(s)) return '已確認'
  if (/(出席|到場|報到|簽到|已到)/.test(s) || /^(是|y|yes|v|✓|○|o|1)$/i.test(s)) return '已到場'
  return fallback
}

export function normalizeCity(raw: string): string {
  const s = (raw ?? '').replace(/臺/g, '台').trim()
  if (!s) return ''
  const m = s.match(/^(台北|新北|基隆|桃園|新竹|苗栗|台中|彰化|南投|雲林|嘉義|台南|高雄|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)(市|縣)?/)
  if (!m) return s.slice(0, 10)
  if (m[2]) return m[0]
  const county = ['苗栗', '彰化', '南投', '雲林', '屏東', '宜蘭', '花蓮', '台東', '澎湖', '金門', '連江']
  return m[1] + (county.includes(m[1]) ? '縣' : '市')   // 新竹、嘉義市縣同名，無後綴時以市為準
}

export const IMPORT_MAX_ROWS = 3000

/**
 * 將一列原始資料轉成 ImportRow；回傳錯誤訊息表示此列無效。
 * defaults 用在單一課程名單（檔案沒有課程欄）與空白狀態。
 */
export function toImportRow(
  cells: string[],
  cols: Partial<Record<ImportField, number>>,
  defaults: { eventName: string; eventDate: string; eventType: string; status: string },
): { row?: ImportRow; error?: string } {
  const get = (f: ImportField) => (cols[f] !== undefined ? (cells[cols[f]!] ?? '').trim() : '')
  const eventName = (get('eventName') || defaults.eventName).slice(0, 200)
  const eventDateRaw = get('eventDate') || defaults.eventDate
  const eventDate = parseLooseDate(eventDateRaw)
  const institution = get('institution').slice(0, 100)
  const typeRaw = get('eventType')
  const eventType = (EVENT_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : defaults.eventType
  if (!eventName) return { error: '缺活動名稱' }
  if (!eventDate) return { error: eventDateRaw ? `日期無法辨識：${eventDateRaw}` : '缺活動日期' }
  if (institution.replace(/\s/g, '').length < 2) return { error: '缺機構名稱' }
  const attendees = Number(get('attendees').replace(/\D/g, '')) || 1
  const email = get('email')
  return {
    row: {
      eventName, eventDate, eventType, institution,
      contact: get('contact').slice(0, 50),
      phone: get('phone').slice(0, 30),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 100) : '',
      city: normalizeCity(get('city')),
      status: normalizeStatus(get('status'), defaults.status),
      attendees: Math.min(attendees, 100),
    },
  }
}

export const eventKey = (name: string, date: string) => `${name.replace(/\s/g, '')}|${date}`
