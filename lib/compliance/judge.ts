/**
 * lib/compliance/judge.ts —— 以 Claude 判讀頁面內容是否「疑似」違反規則庫
 *
 * 只由中央管理手動觸發（會產生 API 費用，不掛排程）。模型只能從規則庫選條、必須交出逐字原文依據；
 * 系統檢核：依據不在頁面原文者丟棄、規則代號不存在者丟棄、低把握者保留但標「低」。
 * 結果一律是「疑似」，須人工審核後才能產出檢舉書。
 */
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { loadCaptureText } from './capture'
import { licensesByApplicant } from './licenses'
import { RULES, RULE_BY_ID } from './rules'
import { type Capture, type Target, addFindingOnce, listCaptures, saveCapture } from './store'

export const JUDGE_MODEL = process.env.COMPLIANCE_MODEL || 'claude-sonnet-5-5'
const MAX_TEXT = 12_000
/** 粗估每頁費用（美元）：以 Sonnet 5.5 每百萬輸入 2、輸出 10 計，每頁約 9k 輸入、600 輸出 */
export const EST_USD_PER_PAGE = 0.024

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule_id: { type: 'string', enum: RULES.filter((r) => r.id !== 'MD-LIC-INVALID').map((r) => r.id) },
          product: { type: 'string' },
          quote: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'string', enum: ['高', '中', '低'] },
        },
        required: ['rule_id', 'product', 'quote', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const

const SYSTEM = `你是協助台灣牙科材料業者做法規遵循檢查的助理。你會收到一個牙科材料／設備業者公開網頁的文字內容，請依下列「規則庫」找出疑似違規之處。

## 原則
- 你只負責標出「疑似」，最後由人審核。寧可漏報，不可誤報：沒有明確原文依據就不要列。
- 每一項必須附 quote：從頁面內容「逐字複製」的一段原文（20 到 150 字），不可改寫、不可拼接。找不到可逐字引用的原文就不要列。
- rule_id 只能從規則庫選。同一段原文只對應最貼切的一條。
- reason 用一兩句話說明為何疑似違反該條，並說明還需要主管機關查明什麼。用語一律「疑似」。
- 沒有疑似違規就回空陣列。大多數頁面應該是空陣列。

## 判斷前提
- 醫療器材的定義（醫療器材管理法第3條）：用於診斷、治療、緩解或直接預防人類疾病，或調節、改善人體結構及機能的儀器、器械、用具、物質、軟體等。
- 醫療器材廣告的定義（第6條）：利用傳播方法，宣傳醫療效能，以達招徠銷售醫療器材為目的。單純的規格、型號、價格、型錄、操作說明、展會與課程公告，而未宣傳醫療效能者，不是廣告。
- 牙技所用的設備與工具（烤瓷爐、鑄造機、噴砂機、研磨工具、石膏、包埋材、技工用蠟等）多數不是醫療器材，不要列。會進入口腔或製成贋復物的材料（瓷粉、氧化鋯塊、樹脂牙、合金、植體、印模材、黏著劑、3D 列印義齒樹脂等）通常是醫療器材。
- 許可證比對：會提供該公司持有的許可證品名清單。頁面上的醫療器材品項若不在清單內、頁面也未標示許可證字號，才考慮 MD-25 或 MD-25-3，且 confidence 最高只能給「中」，因為清單只含牙科類許可證，不含登錄制品項，也可能由原廠或其他代理商持證。
- 廣告核准字號：頁面內容宣傳醫療效能而找不到廣告核准字號，才考慮 MD-41。

## 規則庫
${RULES.filter((r) => r.id !== 'MD-LIC-INVALID').map((r) => `### ${r.id}｜${r.law}${r.article}｜${r.title}\n條文：${r.text}\n判讀：${r.how}`).join('\n\n')}`

let client: Anthropic | null = null
const getClient = () => (process.env.ANTHROPIC_API_KEY ? (client ??= new Anthropic()) : null)
const norm = (s: string) => s.replace(/\s+/g, '')

export type JudgeResult = { judged: number; skipped: number; newFindings: number; dropped: number; errors: string[] }

async function judgeOne(target: Target, capture: Capture, held: string): Promise<{ added: number; dropped: number }> {
  const c = getClient()
  if (!c) throw new Error('ANTHROPIC_API_KEY 未設定')
  // 以存證當時的原始檔為準（並驗證雜湊），依據才對得上證據
  const pageText = await loadCaptureText(capture)
  if (pageText.length < 100) throw new Error('存證內容過短')
  const text = pageText.slice(0, MAX_TEXT)
  const res = await c.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA as any } },
    messages: [{
      role: 'user',
      content: `業者：${target.name}${target.aliases.length ? `（又稱：${target.aliases.join('、')}）` : ''}\n網址：${capture.url}\n頁面標示的許可證字號：${capture.licenseNos.join('、') || '無'}\n頁面標示的廣告核准字號：${capture.adApprovalNos.join('、') || '無'}\n\n該公司作為申請商持有的牙科類有效許可證品名：\n${held || '（以該公司名稱查無持證紀錄；不代表違法）'}\n\n頁面內容：\n${text}`,
    }],
  } as any) as Anthropic.Message
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`模型未完成（${res.stop_reason}）`)
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!block) throw new Error('模型沒有回覆內容')
  const parsed = JSON.parse(block.text) as { findings: { rule_id: string; product: string; quote: string; reason: string; confidence: '高' | '中' | '低' }[] }
  const haystack = norm(pageText)
  let added = 0, dropped = 0
  for (const f of parsed.findings ?? []) {
    const quote = (f.quote ?? '').trim()
    // 系統檢核：規則必須存在、依據必須逐字出現在頁面原文
    if (!RULE_BY_ID.has(f.rule_id) || quote.length < 8 || !haystack.includes(norm(quote))) { dropped++; continue }
    const confidence = (f.rule_id === 'MD-25' || f.rule_id === 'MD-25-3') && f.confidence === '高' ? '中' : f.confidence
    const saved = await addFindingOnce({
      targetId: target.id, captureId: capture.id, url: capture.url, ruleId: f.rule_id, source: 'ai',
      product: (f.product ?? '').slice(0, 120), quote: quote.slice(0, 400), reason: (f.reason ?? '').slice(0, 500), confidence,
    })
    if (saved) added++
  }
  return { added, dropped }
}

/** 判讀某對象尚未判讀的存證頁（每次上限 maxPages，控制費用與時間） */
export async function judgeTarget(target: Target, maxPages = 8): Promise<JudgeResult> {
  const out: JudgeResult = { judged: 0, skipped: 0, newFindings: 0, dropped: 0, errors: [] }
  const held = licensesByApplicant([target.name, ...target.aliases]).filter((l) => !l.st).slice(0, 150).map((l) => l.zh).join('、')
  const pending = (await listCaptures(target.id)).filter((c) => !c.judgedAt)
  out.skipped = Math.max(0, pending.length - maxPages)
  const started = Date.now()
  for (const capture of pending.slice(0, maxPages)) {
    if (Date.now() - started > 50_000) { out.skipped += 1; continue }
    try {
      const r = await judgeOne(target, capture, held)
      out.judged++; out.newFindings += r.added; out.dropped += r.dropped
      await saveCapture({ ...capture, judgedAt: new Date().toISOString() })
    } catch (e: any) {
      out.errors.push(`${capture.url}：${e?.message ?? e}`)
    }
  }
  return out
}
