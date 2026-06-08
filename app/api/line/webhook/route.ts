/**
 * POST /api/line/webhook
 *
 * 接收 LINE Messaging API Webhook。
 * 只處理符合「每日報表」格式的業務訊息，其他訊息一律忽略。
 * 每個編號客戶自動建立一筆客情紀錄。
 *
 * 環境變數：
 *   LINE_CHANNEL_SECRET       — 簽名驗證（必填）
 *   LINE_CHANNEL_ACCESS_TOKEN — 查詢發送人姓名（可選）
 *   LINE_GROUP_ID             — 限定群組（留空則接受所有群組）
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isDailyReport, parseDailyReport } from '@/lib/line-daily-report'
import { resolveSalesperson } from '@/lib/line-salesperson-map'
import { createVisit, searchSystemCustomers, getVisitFormOptions } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

// ── 簽名驗證 ──────────────────────────────────────────────────────────────────

function verifyLineSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) {
    console.warn('[LINE Webhook] LINE_CHANNEL_SECRET 未設定，跳過驗證')
    return true
  }
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64')
  return hash === signature
}

// ── 取得 LINE 顯示名稱 ────────────────────────────────────────────────────────

async function getLineDisplayName(groupId: string, userId: string): Promise<string> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return ''
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return ''
    const data = await res.json()
    return (data.displayName as string) ?? ''
  } catch {
    return ''
  }
}

// ── 主要 Handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-line-signature') ?? ''
  const rawBody = await req.text()

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let events: any[]
  try {
    events = JSON.parse(rawBody).events ?? []
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // 立即回應 LINE（200ms 內）
  void processEvents(events)
  return NextResponse.json({ ok: true })
}

// ── 非同步處理事件 ─────────────────────────────────────────────────────────────

async function processEvents(events: any[]) {
  const targetGroupId = process.env.LINE_GROUP_ID ?? ''

  for (const event of events) {
    try {
      if (event.type !== 'message' || event.message?.type !== 'text') continue
      if (event.source?.type !== 'group') continue
      if (targetGroupId && event.source?.groupId !== targetGroupId) continue

      const text: string = event.message.text ?? ''

      // ── 只處理每日報表格式 ────────────────────────────────────────────────
      if (!isDailyReport(text)) {
        console.log(`[LINE Webhook] skip (not daily report): "${text.slice(0, 30)}…"`)
        continue
      }

      const report = parseDailyReport(text)
      if (!report || report.visits.length === 0) {
        console.log('[LINE Webhook] skip: parsed report has no visits')
        continue
      }

      const groupId: string = event.source.groupId
      const userId: string = event.source.userId ?? ''

      // 取得發送人顯示名稱，並透過對應表轉換為系統業務姓名
      const displayName = await getLineDisplayName(groupId, userId)
      const salesperson = resolveSalesperson(displayName)

      // 取得系統表單選項
      const formOptions = await getVisitFormOptions()

      // ── 每個客戶建立一筆紀錄 ──────────────────────────────────────────────
      for (const visit of report.visits) {
        try {
          // 比對 Notion 客戶主檔
          let customerId: string | undefined
          const matches = await searchSystemCustomers(visit.customerName)
          if (matches.length > 0) customerId = matches[0].id

          // 確認 customerReaction 在系統選項內，否則清空
          const validReaction = formOptions.customerReactions.includes(visit.customerReaction)
            ? visit.customerReaction
            : ''

          await createVisit({
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

          console.log(
            `[LINE Webhook] ✅ ${visit.customerName} / ${salesperson} / ${report.date}`
          )
        } catch (err) {
          console.error(`[LINE Webhook] createVisit error (${visit.customerName}):`, err)
        }
      }
    } catch (err) {
      console.error('[LINE Webhook] processEvents error:', err)
    }
  }
}
