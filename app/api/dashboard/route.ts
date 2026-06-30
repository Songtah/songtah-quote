import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getDashboardSummary } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async () => {
  try {
    const result = await Promise.race<Awaited<ReturnType<typeof getDashboardSummary>> | null>([
      getDashboardSummary(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ])

    if (!result) {
      return NextResponse.json(
        { error: '資料載入逾時，請重新整理頁面' },
        { status: 503 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('dashboard summary error:', error)
    return NextResponse.json({ error: '無法取得資料' }, { status: 500 })
  }
})
