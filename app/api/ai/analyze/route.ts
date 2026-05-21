import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import type { Visit } from '@/lib/system-notion'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type AnalyzeMode = 'customer' | 'overview'

export type CustomerAnalysis = {
  mode: 'customer'
  customerName: string
  opportunityLevel: '高' | '中' | '低'
  opportunityReason: string
  statusSummary: string
  nextActions: string[]
  risks: string[]
  keyInsight: string
}

export type OverviewAnalysis = {
  mode: 'overview'
  period: string
  hotCustomers: Array<{ name: string; reason: string }>
  productDemand: Array<{ product: string; count: number; note: string }>
  competitorThreats: Array<{ competitor: string; count: number; note: string }>
  followUpUrgent: Array<{ name: string; date: string; reason: string }>
  strategicSuggestions: string[]
}

export type AnalysisResult = CustomerAnalysis | OverviewAnalysis

function formatVisitsForPrompt(visits: Visit[]): string {
  return visits.map((v, i) => {
    const lines = [
      `【紀錄 ${i + 1}】`,
      `日期：${v.date?.slice(0, 10) ?? '未知'}`,
      `客戶：${v.customerName}`,
      `業務：${v.salesperson || '未填'}`,
      v.interactionType ? `互動類型：${v.interactionType}` : '',
      v.interactionPurpose ? `互動目的：${v.interactionPurpose}` : '',
      v.customerReaction ? `客戶反應：${v.customerReaction}` : '',
      v.content ? `拜訪內容：${v.content}` : '',
      v.followUpAction ? `後續動作：${v.followUpAction}` : '',
      v.needsFollowUp ? `需追蹤：是${v.nextFollowUpDate ? `（${v.nextFollowUpDate.slice(0, 10)}）` : ''}` : '',
      v.interestedProducts?.length ? `有興趣產品：${v.interestedProducts.map((p) => p.name).join('、')}` : '',
      v.competitorEquipment?.length ? `競品設備：${v.competitorEquipment.join('、')}` : '',
      v.tags?.length ? `標籤：${v.tags.join('、')}` : '',
    ].filter(Boolean)
    return lines.join('\n')
  }).join('\n\n')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: '尚未設定 ANTHROPIC_API_KEY' }, { status: 503 })
  }

  try {
    const body = await req.json()
    const { mode, visits, customerName } = body as {
      mode: AnalyzeMode
      visits: Visit[]
      customerName?: string
    }

    if (!Array.isArray(visits) || visits.length === 0) {
      return NextResponse.json({ error: '沒有可分析的拜訪紀錄' }, { status: 400 })
    }

    const visitsText = formatVisitsForPrompt(visits.slice(0, 60)) // 最多 60 筆，避免 token 過多

    let prompt: string

    if (mode === 'customer') {
      prompt = `你是一位資深牙科材料業務顧問。以下是客戶「${customerName}」的所有拜訪紀錄，請根據這些資料提供商機分析。

拜訪紀錄（共 ${visits.length} 筆，依時間排序）：

${visitsText}

請以 JSON 格式回覆，結構如下：
{
  "opportunityLevel": "高" | "中" | "低",
  "opportunityReason": "一句話說明評估原因",
  "statusSummary": "客戶目前狀態摘要，2-3句，說明購買意願、痛點、關係現況",
  "nextActions": ["建議行動1", "建議行動2", "建議行動3"],
  "risks": ["風險或阻力1", "風險或阻力2"],
  "keyInsight": "最關鍵的一句洞察，讓業務知道現在最重要的事"
}

只回傳 JSON，不要加其他文字。`
    } else {
      prompt = `你是一位資深牙科材料業務顧問。以下是業務團隊最近的客情拜訪紀錄（共 ${visits.length} 筆），請從整體角度分析商機。

拜訪紀錄：

${visitsText}

請以 JSON 格式回覆，結構如下：
{
  "period": "這批紀錄涵蓋的時間範圍（例如：2024/01–2024/03）",
  "hotCustomers": [
    { "name": "客戶名", "reason": "為何列為高潛力，一句話" }
  ],
  "productDemand": [
    { "product": "產品或需求類型", "count": 3, "note": "觀察備註" }
  ],
  "competitorThreats": [
    { "competitor": "競品名", "count": 2, "note": "威脅程度或情境" }
  ],
  "followUpUrgent": [
    { "name": "客戶名", "date": "追蹤日期", "reason": "為何緊急" }
  ],
  "strategicSuggestions": ["整體業務建議1", "整體業務建議2", "整體業務建議3"]
}

hotCustomers 最多 5 筆，productDemand 最多 5 筆，competitorThreats 最多 5 筆，followUpUrgent 最多 5 筆。
只回傳 JSON，不要加其他文字。`
    }

    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

    // 從回覆中擷取第一個完整 JSON 物件（處理 markdown code block 或多餘文字）
    const extractJson = (text: string): string => {
      // 先嘗試去掉 markdown code block
      const stripped = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()
      // 若首字是 { 直接用
      if (stripped.startsWith('{')) return stripped
      // 否則找第一個 { ... } 區段
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1)
      return stripped
    }

    const jsonStr = extractJson(raw)

    let result: AnalysisResult
    try {
      const parsed = JSON.parse(jsonStr)
      result = mode === 'customer'
        ? { mode: 'customer', customerName: customerName ?? '', ...parsed }
        : { mode: 'overview', ...parsed }
    } catch {
      console.error('AI response parse error. raw:', raw)
      return NextResponse.json({ error: 'AI 回覆格式錯誤，請重試' }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('AI analyze error:', error)
    return NextResponse.json({ error: 'AI 分析失敗，請稍後重試' }, { status: 500 })
  }
}
