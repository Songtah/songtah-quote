/**
 * POST /api/line/import
 *
 * 第一步：解析 .txt，回傳 visit 清單（不寫 Notion，速度快）
 * 前端收到後分批呼叫 /api/line/import/batch 建立紀錄。
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseLineTxt } from '@/lib/line-txt-parser'
import { isDailyReport, parseDailyReport } from '@/lib/line-daily-report'
import { resolveSalesperson } from '@/lib/line-salesperson-map'

export const dynamic = 'force-dynamic'

export type ParsedVisitItem = {
  customerName: string
  date: string
  salesperson: string
  content: string
  customerReaction: string
  needsFollowUp: boolean
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '僅限管理員使用' }, { status: 403 })
  }

  let fileContent: string
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '請上傳 .txt 檔案' }, { status: 400 })
    if (!file.name.endsWith('.txt')) {
      return NextResponse.json({ error: '只支援 LINE 匯出的 .txt 格式' }, { status: 400 })
    }
    fileContent = await file.text()
  } catch {
    return NextResponse.json({ error: '無法讀取檔案' }, { status: 400 })
  }

  const messages = parseLineTxt(fileContent)
  if (messages.length === 0) {
    return NextResponse.json(
      { error: '無法解析訊息，請確認是否為 LINE 聊天記錄 .txt 格式' },
      { status: 400 }
    )
  }

  const reportMessages = messages.filter((m) => isDailyReport(m.text))

  const visits: ParsedVisitItem[] = []

  for (const msg of reportMessages) {
    const report = parseDailyReport(msg.text)
    if (!report || report.visits.length === 0) continue
    const salesperson = resolveSalesperson(msg.sender)
    for (const v of report.visits) {
      visits.push({
        customerName: v.customerName,
        date: report.date,
        salesperson,
        content: v.content,
        customerReaction: v.customerReaction,
        needsFollowUp: v.needsFollowUp,
      })
    }
  }

  return NextResponse.json({
    totalMessages: messages.length,
    dailyReports: reportMessages.length,
    total: visits.length,
    visits,
  })
}
