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
  note: string          // 職稱等補充，寫入報名「備註」
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
  status:      ['報名狀態', '狀態', '出席', '出席狀況', '是否出席', '報到', '簽到', '到場'],
  attendees:   ['人數', '參加人數', '報名人數'],
  note:        ['職稱', '職務', '身分', '備註'],
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

/**
 * 找表頭列：整理過的 Excel 常在表頭上方放標題與說明（實例：第 5 列才是表頭）。
 * 取前 20 列中第一個「認得機構名稱，且至少認得 3 個欄位」的列；找不到就當第 1 列。
 */
export function findHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const cols = detectColumns(table[i])
    if (cols.institution !== undefined && Object.keys(cols).length >= 3) return i
  }
  return 0
}

/** Excel 儲存格值 → 字串。日期轉 YYYY-MM-DD（read-excel-file 以 UTC 午夜表示日期，用 UTC 取值避免時區跨日） */
export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return ''
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  return String(v).trim()
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
  // 否定詞先判斷：「報名後未到場」含「到場」、「取消報名」含「報名」，順序錯就會判反
  if (/(取消|退款|退費|未到|未出席|缺席|沒來|沒到)/.test(s) || /^(否|n|no|x|✗)$/i.test(s)) return '取消'
  if (/(欲參加|未確認|待確認|候補)/.test(s)) return '已報名'
  if (/^(已確認|確認)$/.test(s)) return '已確認'
  if (/(出席|到場|報到|簽到|已到)/.test(s) || /^(是|y|yes|v|✓|○|o|1)$/i.test(s)) return '已到場'
  if (/^(報名|已報名)$/.test(s)) return '已報名'
  // 「報名名單」只表示這列來自報名表，出席與否依畫面指定
  return fallback
}

/** 活動類型原文 → 系統選項（實例：課程、說明會／實作、課程／原廠參訪） */
export function normalizeEventType(raw: string, fallback: string): string {
  const s = (raw ?? '').trim()
  if ((EVENT_TYPES as readonly string[]).includes(s)) return s
  // 說明會先判斷：「說明會／實作」是產品說明會，不是培訓課
  if (/(說明會|研討|講座)/.test(s)) return '研討會'
  if (/(課程|實作|工作坊|培訓|班)/.test(s)) return '培訓'
  if (/發表/.test(s)) return '產品發表'
  if (/(展覽|展會|參展)/.test(s)) return '展覽'
  return s ? '其他' : fallback
}

/**
 * 地區原文 → 客戶所在縣市。只接受以縣市開頭的值；
 * 「台北場」「台中場」是上課場地不是客戶所在地、「松山區」沒有縣市，一律視為未填，避免把錯的縣市拿去縮小配對。
 */
export function normalizeCity(raw: string): string {
  const s = (raw ?? '').replace(/臺/g, '台').trim()
  if (!s || /場$/.test(s)) return ''
  const m = s.match(/^(台北|新北|基隆|桃園|新竹|苗栗|台中|彰化|南投|雲林|嘉義|台南|高雄|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)(市|縣)?/)
  if (!m) return ''
  const county = ['苗栗', '彰化', '南投', '雲林', '屏東', '宜蘭', '花蓮', '台東', '澎湖', '金門', '連江']
  // 「彰化市」「宜蘭市」是縣轄市，所在縣市應為彰化縣、宜蘭縣；新竹、嘉義才有獨立的市
  if (county.includes(m[1])) return `${m[1]}縣`
  if (m[2]) return m[0]
  return `${m[1]}市`   // 新竹、嘉義市縣同名，無後綴時以市為準
}

export const IMPORT_MAX_ROWS = 3000

/**
 * 將一列原始資料轉成 ImportRow；回傳錯誤訊息表示此列無效。
 * defaults 用在單一課程名單（檔案沒有課程欄）與空白狀態。
 */
/** 台北今天 YYYY-MM-DD */
export const todayTW = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

/**
 * 活動還沒辦＝不可能已到場：狀態一律降為「已報名」（取消維持取消）。
 * 前端預覽與伺服器寫入共用，確保兩邊看到的一致。
 */
export function statusForDate(status: string, eventDate: string, today = todayTW()): string {
  return eventDate > today && status === '已到場' ? '已報名' : status
}

/** 沒填所屬單位的紀錄在報名 DB 的機構名稱；自動配對看到這個值一律跳過 */
export const UNKNOWN_INSTITUTION = '（未填單位）'
const BLANK_INSTITUTION = /^(無|none|n\/?a|不詳|未填|-|—|－)$/i

/** 單位欄常夾帶電話（實例：「全欣美 黃老闆 0926590966」）：拆出電話，名稱只留單位 */
export function splitInstitutionPhone(raw: string): { institution: string; phone: string } {
  const m = raw.match(/\s*(0\d[\d-]{7,11})\s*$/)
  if (!m) return { institution: raw.trim(), phone: '' }
  return { institution: raw.slice(0, m.index).trim(), phone: m[1] }
}

export function toImportRow(
  cells: string[],
  cols: Partial<Record<ImportField, number>>,
  defaults: { eventName: string; eventDate: string; eventType: string; status: string },
  today = todayTW(),
): { row?: ImportRow; error?: string } {
  const get = (f: ImportField) => (cols[f] !== undefined ? (cells[cols[f]!] ?? '').trim() : '')
  const eventName = (get('eventName') || defaults.eventName).slice(0, 200)
  const eventDateRaw = get('eventDate') || defaults.eventDate
  const eventDate = parseLooseDate(eventDateRaw)
  const split = splitInstitutionPhone(get('institution'))
  const eventType = normalizeEventType(get('eventType'), defaults.eventType)
  const contact = get('contact').slice(0, 50)
  if (!eventName) return { error: '缺活動名稱' }
  if (!eventDate) return { error: eventDateRaw ? `日期無法辨識：${eventDateRaw}` : '缺活動日期' }
  // 沒填單位但有姓名：仍是出席紀錄，保留下來（標成未填單位、不配對客戶），不要丟掉
  const hasInstitution = split.institution.replace(/\s/g, '').length >= 2 && !BLANK_INSTITUTION.test(split.institution)
  if (!hasInstitution && !contact) return { error: '缺所屬單位與姓名' }
  const institution = hasInstitution ? split.institution.slice(0, 100) : UNKNOWN_INSTITUTION
  const attendees = Number(get('attendees').replace(/\D/g, '')) || 1
  const email = get('email')
  return {
    row: {
      eventName, eventDate, eventType, institution, contact,
      phone: (get('phone') || split.phone).slice(0, 30),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 100) : '',
      city: normalizeCity(get('city')),
      status: statusForDate(normalizeStatus(get('status'), defaults.status), eventDate, today),
      attendees: Math.min(attendees, 100),
      note: get('note').slice(0, 200),
    },
  }
}

export const eventKey = (name: string, date: string) => `${name.replace(/\s/g, '')}|${date}`
