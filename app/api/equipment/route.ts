import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { searchEquipment } from '@/lib/system-notion'

function isRateLimited(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; status?: number; body?: { code?: string } }
  return (
    maybeError.code === 'rate_limited' ||
    maybeError.status === 429 ||
    maybeError.body?.code === 'rate_limited'
  )
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q') ?? ''

  try {
    const equipment = await searchEquipment(q)
    return NextResponse.json(equipment)
  } catch (error) {
    console.error('searchEquipment error:', error)
    return NextResponse.json(
      {
        error: isRateLimited(error)
          ? 'Notion 目前忙碌中，設備資料暫時無法同步，請稍後再試。'
          : '無法取得客戶設備資料',
      },
      { status: isRateLimited(error) ? 429 : 500 }
    )
  }
}
