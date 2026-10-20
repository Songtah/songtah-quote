/**
 * lib/visit-reaction-ai.ts —— 用 Claude 判讀客情的「客戶反應」與對口（取代關鍵字規則）
 *
 * 為什麼換掉 lib/line-daily-report.ts 的 REACTION_RULES：那是「出現某詞就貼標籤」，不看前後文。
 * 2026-10-20 抽 30 筆「確認下單」只有約三成真的下單——「小凱老闆在負責訂貨」（講對口）、
 * 「關心上週購買的蒸汽機」（過去式）、「關心訂貨」（業務動作）、「之後量多需要時會訂購」（條件）、
 * 「要訂貨，考慮」（猶豫）全被判成確認下單，並一路推進開發階段、拉高拜訪建議熱度。
 *
 * 做法：Claude Haiku 依明確定義判讀並交出原文依據 → 系統檢核（依據須逐字出現在原文；
 * 確認下單須有已下單／明確承諾的說法；低把握一律留白）。寧可漏判、不可誤判。
 * 呼叫失敗回 null，呼叫端退回關鍵字規則，不影響日報建檔。
 */
import Anthropic from '@anthropic-ai/sdk'

export const REACTION_OPTIONS = [
  '確認下單', '要求報價', '同意試用', '價格有疑慮', '積極詢問', '有興趣待確認',
  '安排再次拜訪', '持觀望態度', '使用競品', '近期無需求', '反應冷淡',
] as const
export type Reaction = (typeof REACTION_OPTIONS)[number]

export type ReactionResult = {
  reaction: Reaction | ''          // '' ＝這次沒有明確的客戶反應
  evidence: string                 // 作為依據的原文片段
  confidence: '高' | '中' | '低'
  contact: string                  // 對口（例：小凱老闆｜負責訂貨、新品），沒有就 ''
  note: string                     // 系統檢核降級的原因（除錯用）
}

export const REACTION_MODEL = 'claude-haiku-5-5'

const SYSTEM = `你是牙科材料代理商的業務主管，負責判讀業務每天回報的拜訪紀錄（客情）。
客戶是牙體技術所、牙醫診所、醫院。業務會在一次拜訪裡介紹多項產品（鋯塊、染劑、樹脂、車機、列印機、掃描機、Dentbird 軟體、課程等）。

你的任務：判斷「客戶在這次拜訪中的反應」，從 11 個標籤選一個；沒有明確反應就選「無明確反應」。
同時抽出紀錄中提到的「對口」：負責訂貨、做採購決策、或主要聯絡的人與其角色。

## 標籤定義（必須看到「必要證據」才能選；符合「不算」就不能選）

確認下單
- 必要證據：客戶在這次拜訪中已經下單、已訂、要了、購買了具體品項或數量，或明確承諾「會買」「確認購買」「簽約」。
- 不算：講誰負責訂貨或誰有購買決定權（這是對口資訊）；過去買過的東西（「上週購買的蒸汽機用得如何」「之前牙展買的」）；業務去「關心訂貨」「追蹤購買意願」「詢問購買意願」而文中沒說結果；條件或未來（「之後量多時會訂購」「年後會購買」）；還在猶豫（「要訂貨，考慮」「老闆還在考慮」）；業務送貨、收款、取貨。

要求報價
- 必要證據：客戶要求報價，或業務答應／已經提供報價單、估價。
- 不算：只是問價格多少（算有興趣待確認或積極詢問）。

同意試用
- 必要證據：客戶同意試用、試機、試作，或收下樣品要試。
- 不算：業務只是介紹有試用方案而客戶沒答應。

價格有疑慮
- 必要證據：客戶明確表示太貴、價格高、預算不夠。

積極詢問
- 必要證據：客戶主動且明顯熱切地詢問細節、規格、導入方式，或「意願強烈」。

有興趣待確認
- 必要證據：客戶表示有興趣、想了解、會跟技師或醫師討論，但沒有進一步行動。

安排再次拜訪
- 必要證據：客戶同意下次見面、約了時間、請業務帶東西再過來。
- 不算：只有業務自己說「之後再去」「晚上會聯絡」而沒有客戶同意。

持觀望態度
- 必要證據：客戶說再看看、考慮中、等等看、還在評估，沒有明確意向。

使用競品
- 必要證據：客戶目前使用或傾向其他品牌，且以此為不採購的理由。

近期無需求
- 必要證據：客戶說目前不需要、暫不考慮、材料還夠、量少不需要。

反應冷淡
- 必要證據：客戶冷淡、不太理會、沒什麼反應。

無明確反應
- 只是例行關心、送貨、收款、維修、遞名片、認識對口、介紹產品但沒寫客戶反應，都選這個。

## 判斷規則
1. 一次拜訪有多個反應時，選「推進最遠」的：確認下單 > 要求報價 > 同意試用 > 價格有疑慮 > 積極詢問 > 有興趣待確認 > 安排再次拜訪 > 持觀望態度 > 使用競品 > 近期無需求 > 反應冷淡。
2. evidence 必須是紀錄中「逐字」出現的一段文字（10 到 40 字），不可改寫、不可摘要。選「無明確反應」時 evidence 留空字串。
3. confidence：證據直接明確選「高」；需要推敲選「中」；勉強才選「低」。
4. contact：格式「稱呼｜角色」，例如「小凱老闆｜負責訂貨、確認新品項」「邱醫師｜大型機器購買決定權」。紀錄沒提到就留空字串。不要把業務自己、公司同事寫成對口。

範例：「主要現在都是小凱老闆在負責訂貨與確認新品項 已留名片 晚上會聯絡」
→ reaction：無明確反應（只是認識對口；晚上聯絡是業務自己的安排），contact：小凱老闆｜負責訂貨、確認新品項`

const SCHEMA = {
  type: 'object',
  properties: {
    reaction: { type: 'string', enum: [...REACTION_OPTIONS, '無明確反應'] },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    contact: { type: 'string' },
  },
  required: ['reaction', 'evidence', 'confidence', 'contact'],
  additionalProperties: false,
} as const

// 「確認下單」的依據必須有已完成或明確承諾的購買說法；否則降級留白
const ORDER_COMMIT = /已下單|下單了|下訂|已訂|訂了|要了|買了|已購買|購買了|確認購買|確認會購買|會購買|決定購買|決定買|簽約|簽合約|叫貨|下單\S{0,6}\d|訂購\S{0,8}\d|購買\S{0,8}\d|要\d|訂\d|買\d|告知下單|先購買|先買/
const norm = (s: string) => (s ?? '').replace(/\s+/g, '')

let client: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return (client ??= new Anthropic())
}

/** 判讀一筆客情。未設定金鑰或 API 失敗回 null（呼叫端退回關鍵字規則）。 */
export async function classifyVisitReaction(text: string): Promise<ReactionResult | null> {
  const body = (text ?? '').trim()
  if (!body) return { reaction: '', evidence: '', confidence: '高', contact: '', note: '空白內容' }
  const c = getClient()
  if (!c) return null
  try {
    const res = await c.messages.create({
      model: REACTION_MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
      messages: [{ role: 'user', content: `拜訪紀錄：\n${body.slice(0, 3000)}` }],
    } as any)
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null
    const out = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!out) return null
    const raw = JSON.parse(out.text) as { reaction: string; evidence: string; confidence: '高' | '中' | '低'; contact: string }
    return guard(body, raw)
  } catch (e) {
    console.warn('[visit-reaction-ai] 判讀失敗，退回關鍵字規則:', (e as Error)?.message ?? e)
    return null
  }
}

/** 系統檢核：依據要逐字出現在原文、低把握留白、確認下單要有承諾說法、對口要真的出現在原文 */
export function guard(text: string, raw: { reaction: string; evidence: string; confidence: '高' | '中' | '低'; contact: string }): ReactionResult {
  const t = norm(text)
  const evidence = (raw.evidence ?? '').trim()
  let reaction: Reaction | '' = (REACTION_OPTIONS as readonly string[]).includes(raw.reaction) ? (raw.reaction as Reaction) : ''
  let note = ''
  if (reaction && (!evidence || !t.includes(norm(evidence)))) { note = `依據不在原文：${evidence}`; reaction = '' }
  if (reaction && raw.confidence === '低') { note = '把握低，留白'; reaction = '' }
  if (reaction === '確認下單' && !ORDER_COMMIT.test(norm(evidence))) { note = `確認下單缺承諾說法：${evidence}`; reaction = '' }
  // 對口：稱呼（｜前）至少要有兩個字出現在原文，避免模型自己編人名
  let contact = (raw.contact ?? '').trim()
  const who = norm(contact.split('｜')[0] ?? '')
  if (contact && (who.length < 2 || !t.includes(who.slice(0, 2)))) contact = ''
  return { reaction, evidence: reaction ? evidence : '', confidence: raw.confidence, contact: contact.slice(0, 60), note }
}
