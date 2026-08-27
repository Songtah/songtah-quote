/**
 * GET  /api/dashboard/collab-points?period=…[&salesperson=]  積分統計＋明細＋全體排行
 * POST /api/dashboard/collab-points                          助攻者申報一筆
 *
 * 依《業務客戶分區管理辦法 2026v4》第八章。使用者說明：積分全體可見，
 * 故排行不分權限一律回傳（金額類統計仍維持只看自己的既有政策，兩者不同）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  listCollabPoints, createCollabPoint, summarizePoints,
  COLLAB_ITEMS, REWARD_TIERS, COUNTED_STATUS, type CollabItem,
} from '@/lib/notion/collab-points'
import { getSystemUsers } from '@/lib/notion/accounts'
import { searchSystemCustomers } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { parsePeriod, resolvePeriod, PERIOD_LABEL, ALL_SALESPEOPLE } from '@/lib/performance-periods'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase('zh-TW') === b.trim().toLocaleLowerCase('zh-TW')
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const me = session.user?.name?.trim() ?? ''
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''
    const focus = requested && requested !== ALL_SALESPEOPLE ? requested : me

    const period = parsePeriod(req.nextUrl.searchParams.get('period'))
    const range = resolvePeriod(period)

    // 已認列者依認列日期落在期間內；待辦（待確認/已確認）不分期間，全部列出
    const [counted, pending] = await Promise.all([
      listCollabPoints({ range: { from: range.from, to: range.to }, status: COUNTED_STATUS }),
      listCollabPoints().then((all) => all.filter((log) => log.status === '待確認' || log.status === '已確認')),
    ])

    // 全體排行：使用者指定積分全體可見
    const agg = new Map<string, { name: string; points: number; entries: number }>()
    for (const log of counted) {
      const name = log.helper || '（未填）'
      const entry = agg.get(name) ?? { name, points: 0, entries: 0 }
      entry.points += log.points
      entry.entries++
      agg.set(name, entry)
    }
    const ranking = Array.from(agg.values()).sort((a, b) => b.points - a.points || b.entries - a.entries)

    const mineCounted = counted.filter((log) => sameName(log.helper, focus))
    const myPoints = mineCounted.reduce((total, log) => total + log.points, 0)

    const accounts = await getSystemUsers().catch(() => [])
    const salespeople = accounts
      .filter((a) => a.accountType === '業務' && a.status !== '停用')
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b, 'zh-TW'))

    return NextResponse.json({
      me,
      focus,
      period,
      periodLabel: PERIOD_LABEL[period],
      range: { from: range.from, to: range.to, label: range.label },
      summary: summarizePoints(myPoints),
      items: mineCounted.map(toItem),
      ranking,
      salespeople,
      // 待我確認的（我是受助業務、狀態待確認）與我提出待處理的
      pendingForMe: pending.filter((l) => sameName(l.helped, me) && l.status === '待確認').map(toItem),
      pendingByMe: pending.filter((l) => sameName(l.helper, me)).map(toItem),
      itemOptions: Object.entries(COLLAB_ITEMS).map(([name, points]) => ({ name, points })),
      rewardTiers: REWARD_TIERS,
    })
  } catch (error) {
    console.error('collab-points GET error:', error)
    return NextResponse.json({ error: '讀取協作積分失敗' }, { status: 500 })
  }
})

function toItem(log: Awaited<ReturnType<typeof listCollabPoints>>[number]) {
  return {
    id: log.id,
    helper: log.helper,
    helped: log.helped,
    customerName: log.customerName,
    customerCity: log.customerCity,
    customerMatched: Boolean(log.customerId),
    item: log.item,
    points: log.points,
    status: log.status,
    countedDate: log.countedDate,
    note: log.note,
    createdTime: log.createdTime,
  }
}

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const me = session.user?.name?.trim() ?? ''
    if (!me) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const body = await req.json()
    const item = String(body.item ?? '') as CollabItem
    const helped = String(body.helped ?? '').trim()
    const note = String(body.note ?? '').trim()
    const caseKey = String(body.caseKey ?? '').trim()
    const customerName = String(body.customerName ?? '').trim()

    if (!(item in COLLAB_ITEMS)) {
      return NextResponse.json({ error: '請選擇有效的助攻項目' }, { status: 400 })
    }
    if (!helped) return NextResponse.json({ error: '請選擇受助業務' }, { status: 400 })
    // 辦法是「協助團隊人員銷售」，自己助攻自己沒有意義，源頭擋掉
    if (sameName(helped, me)) {
      return NextResponse.json({ error: '受助業務不能是自己' }, { status: 400 })
    }

    // 客戶用名稱比對；比對不到就不寫 relation，絕不亂猜（比照 cross-support 的做法）
    let customerId = ''
    if (customerName) {
      const matches = await searchSystemCustomers(customerName).catch(() => [])
      if (matches.length === 1) customerId = matches[0].id
    }

    const created = await createCollabPoint({
      helper: me, helped, item, customerId: customerId || undefined,
      caseKey: caseKey || undefined, note: note || undefined,
    })

    await logAuditEvent({
      module: 'bd',
      action: 'create',
      entityType: 'collab-point',
      entityId: created.id,
      entityTitle: `${me} 助攻 ${helped}｜${item}`,
      summary: `協作積分申報：${item}（${COLLAB_ITEMS[item]} 點），待 ${helped} 確認`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: { helper: me, helped, item, points: COLLAB_ITEMS[item], customerName, caseKey, note },
    }).catch(() => {})

    return NextResponse.json({
      id: created.id,
      points: COLLAB_ITEMS[item],
      customerMatched: Boolean(customerId),
    })
  } catch (error: any) {
    console.error('collab-points POST error:', error)
    return NextResponse.json({ error: error?.message ?? '申報失敗' }, { status: 500 })
  }
})
