/**
 * POST /api/line/webhook
 *
 * 接收 LINE Messaging API Webhook。
 * 只處理業務名單成員、內容為「行程回報」的每日報表，每個編號客戶建立一筆客情紀錄。
 *
 * 2026-09-15 改寫（見 lib/line-report-ingest.ts 檔頭事故說明）：
 *   - 是否匯入改看「行程回報」標記與報表日期（隔天補回報照收、事前計畫不收），同日無標記才看回報窗
 *   - 每則日報先存 Redis 佇列再處理；逾時或失敗由每小時排程 /api/cron/line-report-retry 重試
 *   - 時限 60 → 300 秒；建檔與認領分兩階段；同業務同日同客戶不重複建立
 *
 * 環境變數：
 *   LINE_CHANNEL_SECRET       — 簽名驗證（必填）
 *   LINE_CHANNEL_ACCESS_TOKEN — 查詢發送人姓名（可選）
 *   LINE_GROUP_ID             — 限定群組（留空則接受所有群組）
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { waitUntil } from '@vercel/functions'
import { isDailyReport, decideDailyReportIngest } from '@/lib/line-daily-report'
import { resolveSalesperson, isKnownSalesperson } from '@/lib/line-salesperson-map'
import { enqueueReport, runQueuedReport } from '@/lib/line-report-ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── 簽名驗證 ──────────────────────────────────────────────────────────────────

function verifyLineSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) {
    // 失效必須關閉（fail closed）：密鑰未設定時拒絕所有請求，不可預設放行。
    console.error('[LINE Webhook] LINE_CHANNEL_SECRET 未設定，拒絕所有請求')
    return false
  }
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64')
  const a = Buffer.from(hash)
  const b = Buffer.from(signature ?? '')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
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

  // 立即回應 LINE，讓 Vercel 在背景繼續執行 processEvents
  waitUntil(processEvents(events))
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
      if (!isDailyReport(text)) continue

      // 回報或計畫：看「行程回報」標記與報表日期，同日無標記才看回報窗（lib/line-daily-report）
      const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now()
      const twHour = new Date(ts + 8 * 3600_000).getUTCHours()
      // 日報沒寫日期時的業務日：03:00 前算前一天
      const fallbackDate = new Date(ts + 8 * 3600_000 - 3 * 3600_000).toISOString().slice(0, 10)
      const decision = decideDailyReportIngest({ text, twHour, sendBusinessDay: fallbackDate })
      if (!decision.ingest) {
        console.log(`[LINE Webhook] skip（${decision.reason}）`)
        continue
      }

      const displayName = await getLineDisplayName(event.source.groupId, event.source.userId ?? '')
      if (!isKnownSalesperson(displayName)) {
        console.log(`[LINE Webhook] skip (非業務名單): "${displayName}"`)
        continue
      }
      const salesperson = resolveSalesperson(displayName)

      const record = await enqueueReport({
        id: String(event.message.id ?? `${ts}-${event.source.userId ?? ''}`),
        text, salesperson, fallbackDate,
      })
      await runQueuedReport(record)
    } catch (err) {
      console.error('[LINE Webhook] processEvents error:', err)
    }
  }
}
