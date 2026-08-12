/**
 * POST /api/cron/slack-cross-support-reminder — 每週四早上提醒業務提交跨區支援報備
 *
 * 由 GitHub Action 排程呼叫(x-cron-secret: DAILY_REPORT_SECRET,timing-safe,比照
 * refresh-region-stats 的寫法)。撈本週(週一到今天)已提交的報備,比對業務名單,
 * 點名尚未提交的業務,發到 Slack 業務頻道(SLACK_INCOMING_WEBHOOK_URL)。
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { listCrossSupportLogs } from '@/lib/notion/cross-support'
import { getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function timingSafeSecretMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function thisWeekRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 8 * 3600_000) // 台北時間
  const to = now.toISOString().slice(0, 10)
  const weekday = now.getUTCDay() // 0=日 1=一 ... 4=四
  const mondayOffset = weekday === 0 ? 6 : weekday - 1
  const monday = new Date(now)
  monday.setUTCDate(monday.getUTCDate() - mondayOffset)
  return { from: monday.toISOString().slice(0, 10), to }
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.DAILY_REPORT_SECRET
  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  if (!cronSecret || !headerSecret || !timingSafeSecretMatch(headerSecret, cronSecret)) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  const webhookUrl = process.env.SLACK_INCOMING_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json({ error: 'SLACK_INCOMING_WEBHOOK_URL 未設定' }, { status: 500 })
  }

  try {
    const range = thisWeekRange()
    const [logs, users] = await Promise.all([
      listCrossSupportLogs(range),
      getSystemUsers(),
    ])
    const salespeople = users
      .filter((u) => u.accountType === '業務' && u.status !== '停用')
      .map((u) => u.name)
    const submitted = new Set(logs.map((l) => l.reportingSalesperson))
    const missing = salespeople.filter((name) => !submitted.has(name))

    const text = missing.length === 0
      ? '📋 本週跨區支援報備提醒：全體業務都已提交，辛苦了！'
      : `📋 本週跨區支援報備提醒\n\n本週（${range.from} ～ ${range.to}）尚未提交的業務：\n${missing.map((n) => `・${n}`).join('\n')}\n\n有跨區支援請盡快在業務開發-討論區提交表單。`

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!slackRes.ok) throw new Error(`Slack webhook 回應 ${slackRes.status}`)

    return NextResponse.json({ ok: true, missing, submittedCount: submitted.size })
  } catch (error) {
    console.error('slack-cross-support-reminder error:', error)
    return NextResponse.json({ error: '發送提醒失敗' }, { status: 500 })
  }
}
