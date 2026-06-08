/**
 * POST /api/line/import
 *
 * 上傳 LINE 群組聊天記錄 .txt 檔案，批次解析並匯入客情紀錄。
 * 僅限 admin 使用。
 *
 * Request: multipart/form-data  { file: File (.txt) }
 * Response: { totalMessages, candidates, detected, imported, errors, records, errorDetails }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseLineTxt } from '@/lib/line-txt-parser'
import { parseVisitFromMessage } from '@/lib/line-message-ai'
import { createVisit, searchSystemCustomers, getVisitFormOptions } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

/** 有限制的並行 Promise 池 */
async function asyncPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

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

  // 篩選長度足夠的訊息（太短的不可能是客情紀錄）
  const candidates = messages.filter((m) => m.text.length >= 15)

  // 取得表單選項（供 AI 使用）
  const formOptions = await getVisitFormOptions()

  // AI 批次解析（3 路並行，避免打爆 API）
  const parseResults = await asyncPool(candidates, 3, async (msg) => {
    const parsed = await parseVisitFromMessage(
      msg.text,
      msg.sender,
      msg.date,
      formOptions.interactionTypes,
      formOptions.customerReactions,
    )
    return { ...parsed, sender: msg.sender, rawText: msg.text }
  })

  // 只保留有效的客情紀錄（排除低信心）
  const validRecords = parseResults.filter(
    (p) => p.isVisitRecord && p.customerName && p.confidence !== 'low'
  )

  // 寫入 Notion
  const imported: { customerName: string; date: string; id: string }[] = []
  const errors: { customerName: string | undefined; error: string }[] = []

  for (const record of validRecords) {
    try {
      // 比對 Notion 客戶
      let customerId: string | undefined
      const matches = await searchSystemCustomers(record.customerName!)
      if (matches.length > 0) customerId = matches[0].id

      // 比對業務人員
      const salesperson =
        formOptions.salespersons.find((s) =>
          record.sender.includes(s) || s.includes(record.sender)
        ) ?? record.sender

      const visit = await createVisit({
        customerName: record.customerName!,
        customerId,
        date: record.date,
        salesperson,
        content: record.content ?? record.rawText,
        interactionType: record.interactionType ?? '',
        interactionPurpose: '',
        customerReaction: record.customerReaction ?? '',
        followUpAction: '',
        needsFollowUp: record.needsFollowUp ?? false,
        nextFollowUpDate: '',
        status: '',
        address: '',
        city: '',
        district: '',
        tags: [],
        competitorEquipment: [],
        interestedProductIds: [],
      })

      imported.push({ customerName: record.customerName!, date: record.date, id: visit.id })
    } catch (err: any) {
      errors.push({
        customerName: record.customerName,
        error: err?.message ?? '未知錯誤',
      })
    }
  }

  return NextResponse.json({
    totalMessages: messages.length,
    candidates: candidates.length,
    detected: validRecords.length,
    imported: imported.length,
    errors: errors.length,
    records: imported,
    errorDetails: errors,
  })
}
