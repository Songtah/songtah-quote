/**
 * POST /api/webhooks/slack-cross-support
 *
 * 接收 Slack Events API 的 message.channels 事件(業務開發-討論區頻道)。
 * 只處理符合「跨區支援」格式的文字訊息,其餘訊息一律忽略——比照
 * app/api/line/webhook 對 LINE 每日報表的做法(自由文字打標籤,伺服器解析),
 * 不需要業務填結構化表單。
 *
 * 環境變數:
 *   SLACK_SIGNING_SECRET — Slack App「Basic Information」頁的 Signing Secret,驗證請求簽章(必填)
 *
 * Slack App 設定需求(Event Subscriptions):
 *   Request URL 指到本端點 → 訂閱 bot event「message.channels」→ 需要 channels:history scope
 *   → 安裝 App 到 workspace → 把 bot 邀進「業務開發-討論區」頻道
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { waitUntil } from '@vercel/functions'
import { isCrossSupportReport, parseCrossSupportMessage } from '@/lib/slack-cross-support-parser'
import { KNOWN_SALESPERSON_LIST } from '@/lib/line-salesperson-map'
import { canonicalSalespersonName } from '@/lib/salesperson-name'
import { searchSystemCustomers } from '@/lib/notion/customers'
import { createCrossSupportLog } from '@/lib/notion/cross-support'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const REPLAY_WINDOW_SECONDS = 60 * 5

function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET
  // 失效必須關閉:密鑰未設定時拒絕所有請求,不可預設放行。
  if (!secret) {
    console.error('[Slack cross-support webhook] SLACK_SIGNING_SECRET 未設定,拒絕所有請求')
    return false
  }
  const ts = Number(timestamp)
  if (!ts || Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_SECONDS) return false

  const basestring = `v0:${timestamp}:${rawBody}`
  const expected = `v0=${crypto.createHmac('sha256', secret).update(basestring).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature ?? '')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? ''
  const signature = req.headers.get('x-slack-signature') ?? ''
  const rawBody = await req.text()

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // 暫時性診斷 log(串接測試期間用,穩定後可移除):看清楚每次 Slack 實際送了什麼。
  console.log('[Slack cross-support webhook] body.type=', body.type,
    'event.type=', body.event?.type, 'event.subtype=', body.event?.subtype,
    'bot_id=', body.event?.bot_id, 'text=', body.event?.text)

  // Slack 設定 Event Subscriptions Request URL 時的一次性驗證握手。
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge })
  }

  if (body.type !== 'event_callback' || body.event?.type !== 'message') {
    return NextResponse.json({ ok: true })
  }

  const event = body.event
  // 排除 bot 自己的訊息與訊息編輯/刪除等 subtype,避免迴圈或重複處理。
  if (event.bot_id || event.subtype) {
    return NextResponse.json({ ok: true })
  }

  // 立即回應 Slack(3 秒內),讓 Vercel 在背景繼續處理。
  waitUntil(processMessage(String(event.text ?? '')))
  return NextResponse.json({ ok: true })
}

async function processMessage(text: string) {
  try {
    if (!isCrossSupportReport(text)) return

    const parsed = parseCrossSupportMessage(text)
    if (!parsed) {
      console.log('[Slack cross-support webhook] skip: 格式不完整(缺業務或客戶)')
      return
    }

    const reportingSalesperson = canonicalSalespersonName(parsed.salesperson)
    if (!KNOWN_SALESPERSON_LIST.includes(reportingSalesperson)) {
      console.log(`[Slack cross-support webhook] skip: 非業務名單「${parsed.salesperson}」`)
      return
    }

    const matches = await searchSystemCustomers(parsed.customerName, parsed.city ? { city: parsed.city } : undefined)
    const best = matches.find((m) => m.name === parsed.customerName) ?? matches[0]

    await createCrossSupportLog({
      reportingSalesperson,
      customerId: best?.id ?? '',
      customerName: best?.name ?? parsed.customerName,
      supportDate: parsed.supportDate,
      reason: parsed.reason,
      originalSalesperson: best?.salesperson ?? '',
      rawMessage: text,
    })

    console.log(`[Slack cross-support webhook] ✅ ${reportingSalesperson} / ${parsed.customerName} / ${parsed.supportDate}`)
  } catch (err) {
    console.error('[Slack cross-support webhook] processMessage error:', err)
  }
}
