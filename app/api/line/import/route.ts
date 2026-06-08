/**
 * POST /api/line/import
 *
 * 上傳 LINE 群組聊天記錄 .txt 檔案，批次解析並匯入客情紀錄。
 * 只處理「每日報表」格式，早上行程規劃自動跳過。
 * 僅限 admin 使用。
 *
 * Request: multipart/form-data  { file: File (.txt) }
 * Response: { totalMessages, dailyReports, imported, errors, records, errorDetails }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseLineTxt } from '@/lib/line-txt-parser'
import { isDailyReport, parseDailyReport } from '@/lib/line-daily-report'
import { resolveSalesperson } from '@/lib/line-salesperson-map'
import { createVisit, searchSystemCustomers, getVisitFormOptions } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if ((session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: '僅限管理員使用' }, { status: 403 })
  }

  // 讀取上傳的 .txt 檔案
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

  // 解析 LINE .txt → 訊息列表
  const messages = parseLineTxt(fileContent)
  if (messages.length === 0) {
    return NextResponse.json(
      { error: '無法解析訊息，請確認是否為 LINE 聊天記錄 .txt 格式' },
      { status: 400 }
    )
  }

  // 找出所有「每日報表」訊息（早上行程規劃自動跳過）
  const reportMessages = messages.filter((m) => isDailyReport(m.text))

  if (reportMessages.length === 0) {
    return NextResponse.json({
      totalMessages: messages.length,
      dailyReports: 0,
      imported: 0,
      errors: 0,
      records: [],
      errorDetails: [],
      message: '未找到每日報表格式的訊息',
    })
  }

  const formOptions = await getVisitFormOptions()

  const imported: { customerName: string; date: string; salesperson: string; id: string }[] = []
  const errors: { customerName?: string; sender: string; error: string }[] = []

  for (const msg of reportMessages) {
    const report = parseDailyReport(msg.text)
    if (!report || report.visits.length === 0) continue

    // 業務姓名：先用報表裡的日期對應的發送人，透過對應表轉換
    const salesperson = resolveSalesperson(msg.sender)

    for (const visit of report.visits) {
      try {
        // 比對 Notion 客戶主檔
        let customerId: string | undefined
        const matches = await searchSystemCustomers(visit.customerName)
        if (matches.length > 0) customerId = matches[0].id

        // 確認 customerReaction 在系統選項內
        const validReaction = formOptions.customerReactions.includes(visit.customerReaction)
          ? visit.customerReaction
          : ''

        const created = await createVisit({
          customerName: visit.customerName,
          customerId,
          date: report.date,
          salesperson,
          content: visit.content,
          interactionType: '拜訪',
          interactionPurpose: '',
          customerReaction: validReaction,
          followUpAction: '',
          needsFollowUp: visit.needsFollowUp,
          nextFollowUpDate: '',
          status: '',
          address: '',
          city: '',
          district: '',
          tags: [],
          competitorEquipment: [],
          interestedProductIds: [],
        })

        imported.push({
          customerName: visit.customerName,
          date: report.date,
          salesperson,
          id: created.id,
        })
      } catch (err: any) {
        errors.push({
          customerName: visit.customerName,
          sender: msg.sender,
          error: err?.message ?? '未知錯誤',
        })
      }
    }
  }

  return NextResponse.json({
    totalMessages: messages.length,
    dailyReports: reportMessages.length,
    imported: imported.length,
    errors: errors.length,
    records: imported,
    errorDetails: errors,
  })
}
