/**
 * lib/visit-closure-detect.ts —— 從客情文字判斷「這家已經歇業／停業」（純函式，不碰資料）
 *
 * 2026-10-20 以既有客情回測：65 家提到「退休」的牙技所，58 家其實是「半退休、有缺貨才叫貨」，
 * 仍在營業；真正寫明歇業／停業的只有 7 家。所以「退休」不算，只認明確的結束營業字眼，
 * 並排除五種誤判：否定（沒有歇業）、暫時（過年停業幾天）、講的是別家（聽說隔壁倒了）、
 * 推測假設（感覺快結束營業、若沒人接可能會收起來）、當形容詞用（診所歇業醫師給的機器）。
 * 回測全庫 7,750 筆客情：命中 16 筆，人工檢查皆為明確歇業／停業。「不做了」常指別人（姪子也不做了），不列入。
 */

export type ClosureStatus = '已歇業' | '停業'
export type ClosureHit = { status: ClosureStatus; keyword: string; snippet: string }

// 「沒營業」本身就是結束營業的說法，不能被否定詞規則吃掉，所以放在否定檢查之外
const CLOSE_RE = /歇業|停業|關門|倒閉|結束營業|收掉|收起來|沒營業|沒在營業|沒有營業/g
const SELF_NEGATIVE = new Set(['沒營業', '沒在營業', '沒有營業'])
const NEGATION_BEFORE = /(沒有|沒|未|不是|並非|尚未|還沒|不會|不)\s*$/
const TEMPORARY_NEAR = /暫時|暫停|過年|春節|年假|連假|休假|颱風|裝潢|整修|幾天|一週|一周|週日|周日|星期|禮拜|中午|今天|今日|明天|休診|午休|假日/
const OTHER_PARTY_BEFORE = /隔壁|附近|對面|其他|別家|聽說|朋友|同行|之前那家|原本那家/
const SPECULATIVE_BEFORE = /(快|可能|感覺|似乎|好像|打算|考慮|準備|會|若|如果|將|要|恐|擔心)\s*$/
const MODIFIER_AFTER = /^\s*(的|醫師|醫生|技師|老闆)/

export function detectClosure(text: string): ClosureHit | null {
  const t = (text ?? '').replace(/\s+/g, ' ')
  for (const m of Array.from(t.matchAll(CLOSE_RE))) {
    const kw = m[0]
    const i = m.index ?? 0
    const before = t.slice(Math.max(0, i - 12), i)
    const around = t.slice(Math.max(0, i - 10), i + kw.length + 10)
    if (!SELF_NEGATIVE.has(kw) && NEGATION_BEFORE.test(before.slice(-4))) continue
    if (TEMPORARY_NEAR.test(around)) continue
    if (OTHER_PARTY_BEFORE.test(before)) continue
    if (SPECULATIVE_BEFORE.test(before.slice(-3))) continue
    if (MODIFIER_AFTER.test(t.slice(i + kw.length, i + kw.length + 3))) continue
    return {
      status: kw === '停業' ? '停業' : '已歇業',
      keyword: kw,
      snippet: t.slice(Math.max(0, i - 30), i + kw.length + 30).trim(),
    }
  }
  return null
}
