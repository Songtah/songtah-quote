import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listSeriesRecords, createSeriesRecord } from '@/lib/products-series-notion'

/** GET /api/products/series — list all series records */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const records = await listSeriesRecords()
    return NextResponse.json(records)
  } catch (e: any) {
    console.error('GET /api/products/series error:', e)
    return NextResponse.json({ error: '讀取失敗' }, { status: 500 })
  }
}

/** POST /api/products/series — create a new series record (admin only) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const s = session as any
  const isAdmin = s?.user?.role === 'admin' || s?.user?.accountType === '行政' || s?.user?.accountType === '中央管理'
  if (!isAdmin) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  try {
    const body = await req.json()
    const record = await createSeriesRecord(body)
    return NextResponse.json(record)
  } catch (e: any) {
    console.error('POST /api/products/series error:', e)
    return NextResponse.json({ error: '建立失敗' }, { status: 500 })
  }
}
