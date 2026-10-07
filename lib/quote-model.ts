/**
 * lib/quote-model.ts — 報價單共用規則（前後端共用，不可 import 伺服器端模組）
 *
 * 2026-10-07 依公司紙本報價單（旭達牙體技術所報價單 T-11510071）整合：
 *   - 單號：T-民國年月日＋當日流水號（T-11510071 → 新制 T-115100701，兩碼流水號）
 *   - 日期一律以民國年呈現（115 年 10 月 7 日）
 *   - 稅別：含稅（紙本「本報價單稅金內含」）／未稅（另列 5% 營業稅）
 *   - 有效期限：「本報價單有效至 115 年 11 月 7 日止」
 * 金額一律由此計算；伺服器寫入時必須重算，不採信前端傳來的金額。
 */

export const TAX_RATE = 0.05

export type TaxMode = '含稅' | '未稅'
export const TAX_MODES: TaxMode[] = ['含稅', '未稅']

/** 報價單上要不要顯示的欄位（版面設定，存在每張報價單上） */
export interface QuoteLayout {
  showImage: boolean
  showSpec: boolean
  showUnit: boolean
  showBrand: boolean
}
export const DEFAULT_LAYOUT: QuoteLayout = { showImage: false, showSpec: true, showUnit: true, showBrand: true }

export function parseLayout(raw: unknown): QuoteLayout {
  if (raw && typeof raw === 'object') return { ...DEFAULT_LAYOUT, ...(raw as Partial<QuoteLayout>) }
  if (typeof raw === 'string' && raw.trim()) {
    try { return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) } } catch { /* 壞資料回預設 */ }
  }
  return { ...DEFAULT_LAYOUT }
}

export const PAYMENT_TERM_PRESETS = ['貨到付款', '月結 30 天', '月結 60 天', '預付貨款', '訂金 30%，交貨後付清']
export const DELIVERY_PRESETS = ['現貨，下單後 3 個工作天內出貨', '下單後 7–14 個工作天', '訂製品，交期另議', '含到府安裝']

/** 公司資訊（報價單抬頭、匯款資訊）；依紙本報價單與現行資料 */
export const COMPANY = {
  name: '崧達企業股份有限公司',
  nameEn: 'SONG TAH TRADING CO., LTD.',
  address: '(106) 臺北市大安區敦化南路1段376號12樓之1',
  tel: '(02) 2703-6465',
  fax: '(02) 2705-3571',
  email: 'sales@songtah.com.tw',
  taxId: '30934957',
  bank: { name: '華南商業銀行（總行代號 008）', account: '130-10-000184-7', holder: '崧達企業股份有限公司' },
}

export interface QuoteTotalsInput {
  items: { unitPrice: number; quantity: number }[]
  taxMode?: TaxMode | string
  discount?: number
}
export interface QuoteTotals {
  subtotal: number   // 品項合計
  discount: number   // 折讓（正數）
  tax: number        // 另計的營業稅（含稅時為 0）
  total: number      // 應付總額
  taxIncluded: number // 含稅時，總額內含的稅額（供說明用）
}

const round = (n: number) => Math.round(n)

export function lineAmount(unitPrice: number, quantity: number) {
  return round((Number(unitPrice) || 0) * (Number(quantity) || 0))
}

export function computeQuoteTotals({ items, taxMode = '含稅', discount = 0 }: QuoteTotalsInput): QuoteTotals {
  const subtotal = items.reduce((s, i) => s + lineAmount(i.unitPrice, i.quantity), 0)
  const d = Math.max(0, Math.min(round(Number(discount) || 0), subtotal))
  const base = subtotal - d
  if (taxMode === '未稅') {
    const tax = round(base * TAX_RATE)
    return { subtotal, discount: d, tax, total: base + tax, taxIncluded: 0 }
  }
  return { subtotal, discount: d, tax: 0, total: base, taxIncluded: base - round(base / (1 + TAX_RATE)) }
}

/** 2026-10-07 → 115 年 10 月 7 日 */
export function rocDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso)
  return `${Number(m[1]) - 1911} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`
}

/** 台灣時間的今天（YYYY-MM-DD） */
export function todayTW(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

export function formatMoney(n: number): string {
  return 'NT$ ' + (Number(n) || 0).toLocaleString('zh-TW')
}

/** 金額中文大寫：5300 → 新台幣伍仟參佰元整（報價／請款慣例，防塗改） */
export function amountInChinese(n: number): string {
  const num = Math.round(Math.abs(Number(n) || 0))
  if (num === 0) return '新台幣零元整'
  const digits = '零壹貳參肆伍陸柒捌玖'
  const units = ['', '拾', '佰', '仟']
  const groups = ['', '萬', '億', '兆']
  const s = String(num)
  const chunks: string[] = []
  for (let end = s.length; end > 0; end -= 4) chunks.unshift(s.slice(Math.max(0, end - 4), end))
  let out = ''
  let pendingZero = false
  chunks.forEach((chunk, ci) => {
    const g = groups[chunks.length - 1 - ci]
    let part = ''
    const padded = chunk.padStart(4, '0')
    let chunkZero = false
    for (let i = 0; i < 4; i++) {
      const d = Number(padded[i])
      if (d === 0) { chunkZero = true; continue }
      if ((chunkZero || pendingZero) && (part || out)) part += '零'
      chunkZero = false; pendingZero = false
      part += digits[d] + units[3 - i]
    }
    if (part) { out += part + g; pendingZero = padded.endsWith('0') }
    else if (out) pendingZero = true
  })
  return `新台幣${out}元整`
}
