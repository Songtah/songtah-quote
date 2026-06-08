/**
 * POST /api/line/webhook
 *
 * 接收 LINE Messaging API Webhook，自動將群組客情訊息寫入 Notion。
 *
 * 環境變數需求：
 *   LINE_CHANNEL_SECRET       — 用於驗證簽名（必填）
 *   LINE_CHANNEL_ACCESS_TOKEN — 用於查詢發送人姓名（可選）
 *   LINE_GROUP_ID             — 限定特定群組（留空則接受所有群組）
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { parseVisitFromMessage } from '@/lib/line-message-ai'
import { createVisit, searchSystemCustomers, getVisitFormOptions } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

// ── 簽名驗證 ──────────────────────────────────────────────────────────────────

function verifyLineSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) {
    console.warn('[LINE Webhook] LINE_CHANNEL_SECRET 未設定，跳過驗證')
    return true  // 開發模式下允許
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

  // 立即回應 LINE（必須在 200ms 內）
  void processEvents(events)
  return NextResponse.json({ ok: true })
}

// ── 非同步處理事件 ─────────────────────────────────────────────────────────────

async function processEvents(events: any[]) {
  const targetGroupId = process.env.LINE_GROUP_ID ?? ''

  for (const event of events) {
    try {
      // 只處理群組文字訊息
      if (event.type !== 'message' || event.message?.type !== 'text') continue
      if (event.source?.type !== 'group') continue
      if (targetGroupId && event.source?.groupId !== targetGroupId) continue

      const text: string = event.message.text ?? ''
      if (text.length < 10) continue  // 太短，略過

      const groupId: string = event.source.groupId
      const userId: string = event.source.userId ?? ''
      const date = new Date(event.timestamp).toISOString().split('T')[0]

      // 取得發送人顯示名稱
      const displayName = await getLineDisplayName(groupId, userId)
      const senderLabel = displayName || userId

      // 取得表單選項（有 Redis 快取，速度快）
      const formOptions = await getVisitFormOptions()

      // AI 解析
      const parsed = await parseVisitFromMessage(
        text,
        senderLabel,
        date,
        formOptions.interactionTypes,
        formOptions.customerReactions,
      )

      if (!parsed.isVisitRecord || !parsed.customerName || parsed.confidence === 'low') {
        console.log(`[LINE Webhook] skip (not visit): "${text.slice(0, 30)}…"`)
        continue
      }

      // 比對 Notion 客戶
      let customerId: string | undefined
      const matches = await searchSystemCustomers(parsed.customerName)
      if (matches.length > 0) {
        customerId = matches[0].id
      }

      // 比對業務人員（用顯示名稱對應系統業務清單）
      const salesperson =
        formOptions.salespersons.find((s) =>
          displayName && (displayName.includes(s) || s.includes(displayName))
        ) ?? displayName ?? ''

      await createVisit({
        customerName: parsed.customerName,
        customerId,
        date: parsed.date,
        salesperson,
        content: parsed.content ?? text,
        interactionType: parsed.interactionType ?? '',
        interactionPurpose: '',
        customerReaction: parsed.customerReaction ?? '',
        followUpAction: '',
        needsFollowUp: parsed.needsFollowUp ?? false,
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
        `[LINE Webhook] ✅ created visit: ${parsed.customerName} / ${salesperson} / ${parsed.date}`
      )
    } catch (err) {
      console.error('[LINE Webhook] processEvents error:', err)
    }
  }
}
