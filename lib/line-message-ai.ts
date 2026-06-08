/**
 * 用 Claude Haiku 從 LINE 訊息中識別並擷取客情拜訪資訊
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ParsedVisit = {
  isVisitRecord: boolean
  customerName?: string
  date: string
  interactionType?: string
  customerReaction?: string
  content?: string
  needsFollowUp?: boolean
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `你是牙科耗材代理商的業務系統助理，負責從 LINE 群組訊息中識別並擷取客情拜訪紀錄。

【判斷標準】
客情紀錄（isVisitRecord: true）：
- 提到拜訪/打電話/聯繫某診所或醫師
- 提到客戶的反應、需求、採購意願
- 提到競品狀況、報價、跟進事項

非客情紀錄（isVisitRecord: false）：
- 一般問候、打卡、閒聊
- 行政事務（請假、開會通知等）
- 訊息內容未提及任何客戶名稱
- 太短或無實質內容（如「好的」「OK」「收到」）

【回傳格式】
只回傳 JSON，不要任何說明文字：
{
  "isVisitRecord": boolean,
  "customerName": "診所或客戶完整名稱" | null,
  "interactionType": "從選項中選最接近" | null,
  "customerReaction": "從選項中選最接近" | null,
  "content": "整理後的重點摘要（繁體中文，100字內）" | null,
  "needsFollowUp": boolean,
  "confidence": "high" | "medium" | "low"
}`

export async function parseVisitFromMessage(
  text: string,
  sender: string,
  date: string,
  interactionTypeOptions: string[],
  customerReactionOptions: string[],
): Promise<ParsedVisit> {
  const userContent = `發送人：${sender}
日期：${date}
可用互動類型：${interactionTypeOptions.join('、') || '拜訪、電話、Line、Email、其他'}
可用客戶反應：${customerReactionOptions.join('、') || '有興趣、需考慮、暫不需要、積極配合、無回應'}

訊息內容：
${text}`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
    // 去掉 markdown code fence（有時 model 還是會包）
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(json)

    if (!parsed.isVisitRecord) {
      return { isVisitRecord: false, date, confidence: 'high' }
    }

    return {
      isVisitRecord: true,
      customerName: parsed.customerName ?? undefined,
      date,
      interactionType: parsed.interactionType ?? undefined,
      customerReaction: parsed.customerReaction ?? undefined,
      content: parsed.content ?? undefined,
      needsFollowUp: !!parsed.needsFollowUp,
      confidence: (parsed.confidence as ParsedVisit['confidence']) ?? 'medium',
    }
  } catch (err) {
    console.error('[line-message-ai] parse error:', err)
    return { isVisitRecord: false, date, confidence: 'low' }
  }
}
