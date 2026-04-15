import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardSummary } from '@/lib/system-notion'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const summary = await getDashboardSummary()
    return NextResponse.json(summary)
  } catch (error) {
    console.error('dashboard summary error:', error)
    return NextResponse.json({ error: '無法取得資料' }, { status: 500 })
  }
}
