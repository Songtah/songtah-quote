import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSeriesByCode, updateSeriesRecord, createSeriesRecord } from '@/lib/products-series-notion'

/** GET /api/products/series/[seriesCode] — get series info by code */
export async function GET(
  _req: NextRequest,
  { params }: { params: { seriesCode: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  try {
    const record = await getSeriesByCode(decodeURIComponent(params.seriesCode))
    return NextResponse.json(record ?? null)
  } catch (e: any) {
    console.error('GET /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '讀取失敗' }, { status: 500 })
  }
}

/**
 * PATCH /api/products/series/[seriesCode]
 * Upsert series info — creates if not exists, updates if exists.
 * Admin-only (行政 or 中央管理).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { seriesCode: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const s = session as any
  const isAdmin =
    s?.user?.role === 'admin' ||
    s?.user?.accountType === '行政' ||
    s?.user?.accountType === '中央管理'
  if (!isAdmin) return NextResponse.json({ error: '權限不足' }, { status: 403 })

  try {
    const seriesCode = decodeURIComponent(params.seriesCode)
    const body = await req.json()

    const existing = await getSeriesByCode(seriesCode)
    if (existing) {
      await updateSeriesRecord(existing.id, body)
    } else {
      await createSeriesRecord({
        seriesCode,
        seriesName: body.seriesName ?? seriesCode,
        ...body,
      })
    }

    const updated = await getSeriesByCode(seriesCode)
    return NextResponse.json(updated ?? null)
  } catch (e: any) {
    console.error('PATCH /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '更新失敗' }, { status: 500 })
  }
}
