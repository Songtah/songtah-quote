/**
 * POST /api/cron/campaign-autoclose — 追蹤名單成交自動判定(每晚)
 *
 * 掃訂單:進行中名單的成員,若有「名單建立後」的非取消訂單含任一目標 SKU
 * → 成員自動標「成交」並記成交單號。業務不用回報,數字自己對。
 * 驗證:x-cron-secret = DAILY_REPORT_SECRET(timing-safe,失效關閉)。
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { listOpenMembersForAutoClose, updateMember } from '@/lib/notion/campaigns'
import { listOrders } from '@/lib/orders-notion'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function timingSafeSecretMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.DAILY_REPORT_SECRET
  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  if (!cronSecret || !headerSecret || !timingSafeSecretMatch(headerSecret, cronSecret)) {
    return NextResponse.json({ error: '未授權' }, { status: 401 })
  }

  try {
    const groups = await listOpenMembersForAutoClose()
    if (groups.length === 0) return NextResponse.json({ ok: true, closed: 0, note: '無進行中且設 SKU 的名單' })

    const orders = (await listOrders()).filter((o) => o.status !== '已取消' && o.customerId)
    const nid = (s: string) => (s ?? '').replace(/-/g, '')

    let closed = 0
    const detail: string[] = []
    for (const { campaign, members } of groups) {
      const skuSet = new Set(campaign.targetSkus)
      const since = campaign.createdAt.slice(0, 10) // 只認名單建立後的訂單
      for (const m of members) {
        const hit = orders.find((o) =>
          nid(o.customerId) === nid(m.customerId) &&
          (o.date ?? '') >= since &&
          o.items.some((it) => skuSet.has(it.skuCode))
        )
        if (hit) {
          await updateMember(m.id, { status: '成交', dealOrderNo: hit.orderNumber })
          closed++
          detail.push(`${campaign.name}:${m.name} → ${hit.orderNumber}`)
        }
      }
    }
    return NextResponse.json({ ok: true, closed, detail })
  } catch (error) {
    console.error('campaign-autoclose error:', error)
    return NextResponse.json({ error: '自動結案失敗' }, { status: 500 })
  }
}
