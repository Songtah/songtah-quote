/**
 * POST /api/ai/suggest-reaction
 *
 * 根據拜訪內容文字，從可用選項中建議最符合的「客戶反應」標籤。
 *
 * Body: { content: string; options: string[] }
 * Response: { suggestion: string }   // 若無法判斷回傳 ''
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
    const options: string[] = Array.isArray(body.options) ? body.options.filter(Boolean) : []

    if (!content) return NextResponse.json({ suggestion: '' })
    if (options.length === 0) return NextResponse.json({ suggestion: '' })

    const optionList = options.map((o, i) => `${i + 1}. ${o}`).join('\n')

    const prompt = `你是牙科材料業務顧問的助理。根據以下業務拜訪紀錄，從選項清單中選出最符合的客戶反應標籤。

【拜訪紀錄】
${content}

【可選標籤（請從中選一個）】
${optionList}

規則：
- 只能回傳上方清單中的其中一個標籤，完整文字，不加任何修改
- 不能自行創造新標籤
- 若紀錄文字不足以判斷，回傳數字 0
- 不要加引號、標點或解釋，只回傳標籤文字或 0`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0].type === 'text' ? message.content[0].text : '').trim()

    // 精確匹配：只接受完全等於選項的值
    const matched = options.find((o) => o === raw)
    const suggestion = matched ?? ''

    return NextResponse.json({ suggestion })
  } catch (error: any) {
    console.error('suggest-reaction error:', error)
    return NextResponse.json({ suggestion: '' }) // 靜默失敗，不阻斷使用者流程
  }
}
