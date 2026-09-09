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
import { isInReportWindowTime, businessDayOf, REPORT_WINDOW_LABEL } from '@/lib/line-report-window'

export const dynamic = 'force-dynamic'

export type ParsedVisitItem = {
  customerName: string
  date: string
  salesperson: string
  content: string
  customerReaction: string
  needsFollowUp: boolean
  nextFollowUpDate: string
}

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  let fileContent: string
  let dateFrom = ''           // 只匯入此日期(含)以後的日報，留空 = 全部
  let salespersonFilter = ''  // 只匯入此業務的日報，留空 = 全部名單業務
  let ignoreWindow = false    // true = 不套回報窗（救援用；預設與 webhook 同標準）
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
    ignoreWindow = (formData.get('ignoreWindow') as string | null) === '1'
  } catch {
    return NextResponse.json({ error: '無法讀取檔案' }, { status: 400 })
  }

  const user = session.user as any
  const canImportForOthers = user?.role === 'admin' || user?.accountType === '中央管理'
  const actorName = session.user?.name ?? ''
  if (!canImportForOthers) salespersonFilter = actorName

  const messages = parseLineTxt(fileContent)
  if (messages.length === 0) {
    return NextResponse.json(
      { error: '無法解析訊息，請確認是否為 LINE 聊天記錄 .txt 格式' },
      { status: 400 }
    )
  }

  const reportMessages = messages.filter((m) => isDailyReport(m.text))

  const visits: ParsedVisitItem[] = []

  // 回報窗與業務日：與 webhook 用同一套判定（lib/line-report-window）。
  // 匯入路徑原本完全沒做這道過濾，白天的訊息只要長得像日報就會被匯入。
  let skippedByWindow = 0
  for (const msg of reportMessages) {
    // 只匯入業務名單上的業務（非名單成員的訊息一律跳過）
    if (!isKnownSalesperson(msg.sender)) continue
    const salesperson = resolveSalesperson(msg.sender)
    if (!canImportForOthers && salesperson !== actorName) continue
    // 業務篩選：只匯入指定業務的日報
    if (salespersonFilter && salesperson !== salespersonFilter) continue
    // 回報窗 17:00～隔日 03:00；救援匯入可用 ignoreWindow 放行
    if (!ignoreWindow && !isInReportWindowTime(msg.time)) { skippedByWindow++; continue }
    // 業務日 03:00 換日：凌晨發的日報屬前一天。日報若沒寫「日期：」就用這個值，
    // 不可退回「今天」——否則匯入歷史檔案會把全部紀錄標成匯入當日。
    const report = parseDailyReport(msg.text, businessDayOf(msg.date, msg.time))
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
        nextFollowUpDate: v.nextFollowUpDate,
      })
    }
  }

  return NextResponse.json({
    totalMessages: messages.length,
    dailyReports: reportMessages.length,
    total: visits.length,
    skippedByWindow,
    reportWindow: REPORT_WINDOW_LABEL,
    visits,
  })
})
