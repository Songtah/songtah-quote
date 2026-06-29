/**
 * POST /api/line/import
 *
 * 第一步：解析 .txt，回傳 visit 清單（不寫 Notion，速度快）
 * 前端收到後分批呼叫 /api/line/import/batch 建立紀錄。
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { parseLineTxt } from '@/lib/line-txt-parser'
import { isDailyReport, parseDailyReport } from '@/lib/line-daily-report'
import { resolveSalesperson, isKnownSalesperson } from '@/lib/line-salesperson-map'

export const dynamic = 'force-dynamic'

export type ParsedVisitItem = {
  customerName: string
  date: string
  salesperson: string
  content: string
  customerReaction: string
  needsFollowUp: boolean
}

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  let fileContent: string
  let dateFrom = ''           // 只匯入此日期(含)以後的日報，留空 = 全部
  let salespersonFilter = ''  // 只匯入此業務的日報，留空 = 全部名單業務
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '請上傳 .txt 檔案' }, { status: 400 })
    if (!file.name.endsWith('.txt')) {
      return NextResponse.json({ error: '只支援 LINE 匯出的 .txt 格式' }, { status: 400 })
    }
    fileContent = await file.text()
    dateFrom = (formData.get('dateFrom') as string | null)?.trim() ?? ''
    salespersonFilter = (formData.get('salesperson') as string | null)?.trim() ?? ''
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
    // 只匯入業務名單上的業務（非名單成員的訊息一律跳過）
    if (!isKnownSalesperson(msg.sender)) continue
    const salesperson = resolveSalesperson(msg.sender)
    // 業務篩選：只匯入指定業務的日報
    if (salespersonFilter && salesperson !== salespersonFilter) continue
    const report = parseDailyReport(msg.text)
    if (!report || report.visits.length === 0) continue
    // 起始日期篩選：只補抓指定日期之後的報表
    if (dateFrom && report.date < dateFrom) continue
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
})
