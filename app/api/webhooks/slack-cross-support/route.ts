/**
 * POST /api/webhooks/slack-cross-support
 *
 * 接收 Slack Workflow Builder「送出 Webhook」步驟的表單資料，寫入「跨區支援報備」。
 * 不掛勾訂單/業績計算，只關聯客戶主檔——比對不到客戶就留白+標「待確認」，絕不亂猜。
 *
 * Slack 表單欄位(於 Workflow Builder 設定,body 對應這些 key):
 *   token      — 共用密鑰(Workflow 固定值,非使用者填寫),對應 SLACK_CROSS_SUPPORT_SECRET
 *   業務姓名   — 固定選單,比對業務名單
 *   客戶名稱   — 文字
 *   縣市       — 下拉,輔助比對降低誤配
 *   支援日期   — 日期
 *   支援事由   — 文字
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { searchSystemCustomers } from '@/lib/notion/customers'
import { createCrossSupportLog } from '@/lib/notion/cross-support'
import { canonicalSalespersonName } from '@/lib/salesperson-name'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function timingSafeSecretMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  const secret = process.env.SLACK_CROSS_SUPPORT_SECRET
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const token = typeof body?.token === 'string' ? body.token : ''
  // 失效必須關閉:密鑰未設定或不符一律拒絕。
  if (!secret || !token || !timingSafeSecretMatch(token, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const reportingSalesperson = canonicalSalespersonName(String(body?.['業務姓名'] ?? '').trim())
  const customerName = String(body?.['客戶名稱'] ?? '').trim()
  const city = String(body?.['縣市'] ?? '').trim()
  const supportDate = String(body?.['支援日期'] ?? '').trim()
  const reason = String(body?.['支援事由'] ?? '').trim()

  if (!reportingSalesperson || !customerName || !supportDate) {
    return NextResponse.json({ error: '缺少必填欄位(業務姓名/客戶名稱/支援日期)' }, { status: 400 })
  }

  try {
    const matches = await searchSystemCustomers(customerName, city ? { city } : undefined)
    const best = matches.find((m) => m.name === customerName) ?? matches[0]

    await createCrossSupportLog({
      reportingSalesperson,
      customerId: best?.id ?? '',
      customerName: best?.name ?? customerName,
      supportDate,
      reason,
      originalSalesperson: best?.salesperson ?? '',
      rawMessage: JSON.stringify(body),
    })

    return NextResponse.json({ ok: true, matched: !!best })
  } catch (error) {
    console.error('[slack-cross-support webhook] error:', error)
    return NextResponse.json({ error: '寫入失敗' }, { status: 500 })
  }
}
