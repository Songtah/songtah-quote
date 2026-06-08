/**
 * POST /api/ai/suggest-fields
 *
 * 根據拜訪內容，一次建議「互動類型」與「客戶反應」兩個欄位。
 * 供「一鍵分析」批次功能使用，減少 API 呼叫次數。
 *
 * Body:
 *   content: string                  — 拜訪內容文字
 *   interactionTypeOptions: string[] — 可選的互動類型清單
 *   reactionOptions: string[]        — 可選的客戶反應清單
 *
 * Response:
 *   { interactionType: string; customerReaction: string }
 *   （無法判斷的欄位回傳 ''）
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: '尚未設定 ANTHROPIC_API_KEY' }, { status: 503 })
  }

  try {
    const body = await req.json()
    const content: string = (body.content ?? '').trim()
    const interactionTypeOptions: string[] = Array.isArray(body.interactionTypeOptions)
      ? body.interactionTypeOptions.filter(Boolean)
      : []
    const reactionOptions: string[] = Array.isArray(body.reactionOptions)
      ? body.reactionOptions.filter(Boolean)
      : []

    if (!content) {
      return NextResponse.json({ interactionType: '', customerReaction: '' })
    }

    const interactionList = interactionTypeOptions.map((o, i) => `${i + 1}. ${o}`).join('\n')
    const reactionList = reactionOptions.map((o, i) => `${i + 1}. ${o}`).join('\n')

    const prompt = `你是牙科材料業務顧問的助理。根據以下業務拜訪紀錄，分別從兩份清單中各選出最符合的標籤。

【拜訪紀錄】
${content}

【互動類型清單（選一個最符合的）】
${interactionList || '（無選項）'}

【客戶反應清單（選一個最符合的）】
${reactionList || '（無選項）'}

規則：
- 只能回傳清單中的標籤，完整文字，不加修改
- 若紀錄文字不足以判斷某欄位，該欄位填 ""
- 以 JSON 格式回傳，格式如下：
{"interactionType": "拜訪", "customerReaction": "有興趣待確認"}
- 不要加其他說明文字，只回傳 JSON`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0].type === 'text' ? message.content[0].text : '').trim()

    let interactionType = ''
    let customerReaction = ''

    try {
      const stripped = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()
      const parsed = JSON.parse(stripped)
      // 僅接受清單中的值
      if (typeof parsed.interactionType === 'string') {
        interactionType = interactionTypeOptions.includes(parsed.interactionType)
          ? parsed.interactionType
          : ''
      }
      if (typeof parsed.customerReaction === 'string') {
        customerReaction = reactionOptions.includes(parsed.customerReaction)
          ? parsed.customerReaction
          : ''
      }
    } catch {
      // 靜默失敗
    }

    return NextResponse.json({ interactionType, customerReaction })
  } catch (error) {
    console.error('suggest-fields error:', error)
    return NextResponse.json({ interactionType: '', customerReaction: '' })
  }
}
