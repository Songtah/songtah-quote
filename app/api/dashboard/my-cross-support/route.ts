/**
 * GET /api/dashboard/my-cross-support?period=week|month|quarter|year[&salesperson=]
 *
 * 個人頁的跨區支援名單。
 *
 * 與 /api/dashboard/cross-support（老闆儀表板，限行政/中央管理/總經理）的差別：
 * 這支開放給業務讀「自己報備的」紀錄——依《業務客戶分區管理辦法》第四章，
 * 跨區支援的名單本來就該讓支援業務自己看得到、好追蹤 14 日成交期限。
 * 一般業務一律只回本人資料，忽略 salesperson 參數；管理帳號不指定時看全體。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCrossSupportLogs } from '@/lib/notion/cross-support'
import { parsePeriod, resolvePeriod, PERIOD_LABEL, ALL_SALESPEOPLE } from '@/lib/performance-periods'

export const dynamic = 'force-dynamic'

/** 辦法第四章：活動結束日起 14 日內成交，設備業績仍歸支援業務 */
const TRACKING_DAYS = 14

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase('zh-TW') === b.trim().toLocaleLowerCase('zh-TW')
}

/** 距離追蹤期限剩幾天（負數＝已過期） */
function daysLeft(supportDate: string, today: string): number | null {
  if (!supportDate) return null
  const start = Date.parse(`${supportDate}T00:00:00+08:00`)
  const now = Date.parse(`${today}T00:00:00+08:00`)
  if (Number.isNaN(start) || Number.isNaN(now)) return null
  return TRACKING_DAYS - Math.floor((now - start) / 86_400_000)
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const user = session.user as any
    const canViewOthers = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''
    const teamMode = canViewOthers && (requested === '' || requested === ALL_SALESPEOPLE)
    const owner = teamMode ? '' : (canViewOthers && requested ? requested : (session.user?.name?.trim() ?? ''))
    if (!teamMode && !owner) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const period = parsePeriod(req.nextUrl.searchParams.get('period'))
    const range = resolvePeriod(period)
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

    const all = await listCrossSupportLogs({ from: range.from, to: range.to })
    const mine = teamMode ? all : all.filter((log) => sameName(log.reportingSalesperson, owner))

    const items = mine.map((log) => {
      const left = daysLeft(log.supportDate, today)
      return {
        id: log.id,
        reportingSalesperson: log.reportingSalesperson,
        customerName: log.customerName || '（客戶未比對到）',
        customerCity: log.customerCity,
        supportDate: log.supportDate,
        reason: log.reason,
        originalSalesperson: log.originalSalesperson,
        status: log.status,
        // 辦法第四章的 14 日追蹤期限：仍在期限內者，設備業績歸支援業務
        trackingDaysLeft: left,
        trackingActive: left !== null && left >= 0,
      }
    })

    const bySalesperson: Record<string, number> = {}
    for (const item of items) {
      const name = item.reportingSalesperson || '（未填）'
      bySalesperson[name] = (bySalesperson[name] ?? 0) + 1
    }

    return NextResponse.json({
      scope: teamMode ? 'team' : 'self',
      salesperson: teamMode ? '全部業務' : owner,
      period,
      periodLabel: PERIOD_LABEL[period],
      range: { from: range.from, to: range.to, label: range.label },
      total: items.length,
      trackingActive: items.filter((i) => i.trackingActive).length,
      bySalesperson,
      items,
    })
  } catch (error) {
    console.error('my-cross-support GET error:', error)
    return NextResponse.json({ error: '讀取跨區支援名單失敗' }, { status: 500 })
  }
})
