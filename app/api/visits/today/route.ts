/**
 * GET /api/visits/today?date=YYYY-MM-DD
 *
 * 回傳指定日期（預設台北今日）的拜訪紀錄，依業務分組。
 * Response: { date, groups: [{ salesperson, count, visits[] }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchTodayVisits, todayTW } from '@/lib/ceo-stats'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date') ?? todayTW()

  try {
    const visits = await fetchTodayVisits(date)

    // 依業務分組
    const map = new Map<string, typeof visits>()
    for (const v of visits) {
      const sp = v.salesperson?.trim() || '未指定'
      if (!map.has(sp)) map.set(sp, [])
      map.get(sp)!.push(v)
    }

    const groups = Array.from(map.entries()).map(([salesperson, vs]) => ({
      salesperson,
      count: vs.length,
      visits: vs,
    }))

    return NextResponse.json({ date, groups })
  } catch (error: any) {
    console.error('visits/today error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
}
