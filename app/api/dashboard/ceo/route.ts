import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCEOStats } from '@/lib/ceo-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

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
}
