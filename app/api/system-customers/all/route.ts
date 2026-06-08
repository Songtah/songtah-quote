import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listSystemCustomersPaginated } from '@/lib/system-notion'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  try {
    const p = req.nextUrl.searchParams
    const limit = Math.min(parseInt(p.get('limit') ?? '10') || 10, 100)
    const cursor = p.get('cursor') ?? undefined
    const result = await listSystemCustomersPaginated({ limit, cursor })
    return NextResponse.json(result)
  } catch (error) {
    console.error('listSystemCustomersPaginated error:', error)
    return NextResponse.json({ items: [], hasMore: false, nextCursor: null }, { status: 200 }) // graceful fallback
  }
}
