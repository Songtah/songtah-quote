import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCEOStats } from '@/lib/ceo-stats'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ roles: ['行政', '中央管理', '總經理'] }, async () => {
  try {
    const result = await Promise.race<Awaited<ReturnType<typeof getCEOStats>> | null>([
      getCEOStats(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ])

    if (!result) {
      return NextResponse.json({ error: '資料載入逾時，請稍後重試' }, { status: 503 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('CEO dashboard error:', error)
    return NextResponse.json({ error: '無法取得資料' }, { status: 500 })
  }
})
