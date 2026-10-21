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
 * 呼叫失敗回 null，呼叫端留白，不影響日報建檔。
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
  repair: RepairFinding | null     // 這次拜訪提到「我們要處理的」維修案件；沒有就 null
}

/** 客情中提到的維修案件（由 lib/visit-repair-tickets.ts 開成技術支援工單） */
export type RepairFinding = {
  status: '待處理' | '處理中' | '已完成'
  equipment: string                // 設備（品牌型號，照紀錄寫法），例：Zirkonzahn 燒結爐
  issue: string                    // 問題描述，例：不會升溫
  evidence: string                 // 原文依據
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
4. contact：格式「稱呼｜角色」，例如「小凱老闆｜負責訂貨、確認新品項」「邱醫師｜大型機器購買決定權」。
   - 只寫有具體稱呼的人（含姓氏或名字，如林主任、小凱老闆、彭理事長）；只有職稱（老闆、醫師、院長、技師）就留空字串。
   - 角色只寫紀錄裡明說的（負責訂貨、採購決定、主要聯絡）；沒明說就只寫稱呼、不加「｜」。
   - 不要寫公司自己的人：業務、技術人員、行政（例如 Ray、Luca、王小姐、林總）。

## 維修案件（與客戶反應分開判斷）
判斷這次紀錄有沒有提到「需要崧達處理、或崧達已經處理」的設備維修、故障、校正、保養。
- repair_status：
  - 待處理：客戶反映故障或異常，需要安排維修、尚未處理（「爐子不會升溫，需安排維修」「近期安排維修」）
  - 處理中：已取回送修、已到場處理但未完成、等零件、明天再去確認（「取回需維修技工桌控制器」「明早再前往確認」）
  - 已完成：這次已經修好、校正好、處理完畢（「手機維修（已完成）」「重新校正就可以正常使用」）
  - 無：沒有提到維修，或不屬於崧達要處理的維修
- 不算維修案件（選「無」）：別家原廠或其他廠商的售後（「有遇到 arum 的售後在做維修」「金妮可有維修部」）；客戶自己修；只是關心機器狀況、運作正常（「校正完還蠻穩定的」）；業務只是介紹維修服務。
- repair_equipment：設備，照紀錄寫法（如「zz 爐子」「asiga」「技工桌控制器」「手機」），不知道就空字串。
- repair_issue：問題，10 字左右（如「不會升溫」「無法開機」）。
- repair_evidence：作為依據的原文，逐字 10 到 40 字；選「無」時留空字串。

範例：「主要現在都是小凱老闆在負責訂貨與確認新品項 已留名片 晚上會聯絡」
→ reaction：無明確反應（只是認識對口；晚上聯絡是業務自己的安排），contact：小凱老闆｜負責訂貨、確認新品項`

const SCHEMA = {
  type: 'object',
  properties: {
    reaction: { type: 'string', enum: [...REACTION_OPTIONS, '無明確反應'] },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    contact: { type: 'string' },
    repair_status: { type: 'string', enum: ['無', '待處理', '處理中', '已完成'] },
    repair_equipment: { type: 'string' },
    repair_issue: { type: 'string' },
    repair_evidence: { type: 'string' },
  },
  required: ['reaction', 'evidence', 'confidence', 'contact', 'repair_status', 'repair_equipment', 'repair_issue', 'repair_evidence'],
  additionalProperties: false,
} as const

// 「確認下單」的依據若帶有可疑字眼（關心、追蹤、意願、負責、之前、需要時、考慮…）且沒有明確的購買說法，降級留白。
// 2026-10-20 驗證集：原本改成「必須出現指定說法才放行」，把「黃醫師購買一組」「要訂石膏5箱」「asiga合約簽訂」
// 「另外加購BUR」等 12 筆真下單全擋掉；AI 本身判確認下單約九成正確，所以改成只擋可疑者。
const ORDER_DOUBT = /關心|追蹤|意願|負責|決定權|之前|以前|上次|上週|曾經|需要時|用完|考慮|評估|討論中|詢問/
const ORDER_COMMIT = /已下單|下單了|下訂|已訂|訂了|要了|買了|已購買|購買了|確認購買|確定要買|確認會購買|決定購買|簽約|簽合約|簽訂|叫了|加購|另外訂|要訂|告知下單|一(組|箱|盒|罐|片|支|包|瓶|桶|台|顆|套)|\d\s*(組|箱|盒|罐|片|支|包|瓶|桶|台|顆|套)/
// 公司內部人員不是對口；只有職稱沒有稱呼的也不算
const INTERNAL_NAMES = /^(Ray|Luca|Paul|Aaron|Ted|Otis|Hank|Duncan|Eason|Sam|Edward|Amy|Gus|Chloe|王小姐|林總|小黃|小郭|小宏|致廷|業務|公司)/i
const TITLE_ONLY = /^(老闆|老板|老闆娘|老板娘|闆娘|小老闆|院長|副院長|醫師|醫生|技師|技師長|主任|經理|採購|助理|窗口|櫃台|女兒|兒子|理事長|所長|總監|老師|醫工|師傅|大哥|大姐)$/
const norm = (s: string) => (s ?? '').replace(/\s+/g, '')

let client: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return (client ??= new Anthropic())
}

/** 一筆客情的判讀請求參數（單筆判讀與批次重跑共用，確保兩邊同一套指示） */
export function reactionRequestParams(text: string) {
  return {
    model: REACTION_MODEL,
    max_tokens: 2000,
    system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: SCHEMA as any } },
    messages: [{ role: 'user' as const, content: `拜訪紀錄：\n${(text ?? '').trim().slice(0, 3000)}` }],
  }
}

/** 把模型回覆解析成檢核後的結果；拒答、被截斷、格式不對回 null */
export function parseReactionMessage(text: string, res: Pick<Anthropic.Message, 'content' | 'stop_reason'>): ReactionResult | null {
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null
  const out = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!out) return null
  try {
    return guard(text, JSON.parse(out.text))
  } catch {
    return null
  }
}

/** 判讀一筆客情。未設定金鑰或 API 失敗回 null（呼叫端留白）。 */
export async function classifyVisitReaction(text: string): Promise<ReactionResult | null> {
  const body = (text ?? '').trim()
  if (!body) return { reaction: '', evidence: '', confidence: '高', contact: '', note: '空白內容', repair: null }
  const c = getClient()
  if (!c) return null
  try {
    const res = await c.messages.create(reactionRequestParams(body) as any)
    return parseReactionMessage(body, res as Anthropic.Message)
  } catch (e) {
    console.warn('[visit-reaction-ai] 判讀失敗:', (e as Error)?.message ?? e)
    return null
  }
}

export function getReactionClient(): Anthropic | null {
  return getClient()
}

/** 系統檢核：依據要逐字出現在原文、低把握留白、確認下單要有承諾說法、對口要真的出現在原文 */
export function guard(text: string, raw: {
  reaction: string; evidence: string; confidence: '高' | '中' | '低'; contact: string
  repair_status?: string; repair_equipment?: string; repair_issue?: string; repair_evidence?: string
}): ReactionResult {
  const t = norm(text)
  const evidence = (raw.evidence ?? '').trim()
  let reaction: Reaction | '' = (REACTION_OPTIONS as readonly string[]).includes(raw.reaction) ? (raw.reaction as Reaction) : ''
  let note = ''
  if (reaction && (!evidence || !t.includes(norm(evidence)))) { note = `依據不在原文：${evidence}`; reaction = '' }
  if (reaction && raw.confidence === '低') { note = '把握低，留白'; reaction = '' }
  if (reaction === '確認下單' && ORDER_DOUBT.test(evidence) && !ORDER_COMMIT.test(evidence)) { note = `確認下單證據可疑：${evidence}`; reaction = '' }
  // 對口：要有具體稱呼、出現在原文、不是公司內部人員；角色寫「未註明」之類的就只留稱呼
  let contact = (raw.contact ?? '').trim()
  const [whoRaw, roleRaw = ''] = contact.split('｜')
  const who = norm(whoRaw).replace(/[（(].*$/, '')
  const role = /未(註明|說明|明|載明|提)|不明|待確認|角色/.test(roleRaw) ? '' : roleRaw.trim()
  // 「技師、經理」「總公司採購」「主要技師」這類泛稱也不算具體對口
  const generic = /、/.test(who) || TITLE_ONLY.test(who.replace(/^(總公司|主要|年輕|資深|新)/, ''))
  if (!who || who.length < 2 || generic || INTERNAL_NAMES.test(who) || !t.includes(who.slice(0, 2))) contact = ''
  else contact = role ? `${who}｜${role.slice(0, 24)}` : who
  // 維修：依據要逐字出現在原文，否則不開工單（寧可漏開、不可亂開）
  let repair: RepairFinding | null = null
  const rs = raw.repair_status
  const rev = (raw.repair_evidence ?? '').trim()
  if ((rs === '待處理' || rs === '處理中' || rs === '已完成') && rev && t.includes(norm(rev))) {
    repair = { status: rs, equipment: (raw.repair_equipment ?? '').trim().slice(0, 40), issue: (raw.repair_issue ?? '').trim().slice(0, 40), evidence: rev }
  }
  return { reaction, evidence: reaction ? evidence : '', confidence: raw.confidence, contact: contact.slice(0, 60), note, repair }
}
