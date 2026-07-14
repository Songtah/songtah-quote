import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSeriesByCode, updateSeriesRecord, createSeriesRecord } from '@/lib/products-series-notion'

/** GET /api/products/series/[seriesCode] — get series info by code */
export const GET = withApiAuth<{ params: { seriesCode: string } }>('session', async (
  _req: NextRequest,
  { params }: { params: { seriesCode: string } }
) => {
  try {
    const record = await getSeriesByCode(decodeURIComponent(params.seriesCode))
    return NextResponse.json(record ?? null)
  } catch (e: any) {
    console.error('GET /api/products/series/[code] error:', e)
    return NextResponse.json({ error: '讀取失敗' }, { status: 500 })
  }
})

/**
 * PATCH /api/products/series/[seriesCode]
 * Upsert series info — creates if not exists, updates if exists.
 * Central management only.
 */
export const PATCH = withApiAuth<{ params: { seriesCode: string } }>('central-management', async (
  req: NextRequest,
  { params }: { params: { seriesCode: string } }
) => {
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
})
