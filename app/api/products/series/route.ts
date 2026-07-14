import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listSeriesRecords, createSeriesRecord } from '@/lib/products-series-notion'

/** GET /api/products/series — list all series records */
export const GET = withApiAuth('session', async () => {
  try {
    const records = await listSeriesRecords()
    return NextResponse.json(records)
  } catch (e: any) {
    console.error('GET /api/products/series error:', e)
    return NextResponse.json({ error: '讀取失敗' }, { status: 500 })
  }
})

/** POST /api/products/series — create a new series record (admin only) */
export const POST = withApiAuth('central-management', async (req) => {
  try {
    const body = await req.json()
    const record = await createSeriesRecord(body)
    return NextResponse.json(record)
  } catch (e: any) {
    console.error('POST /api/products/series error:', e)
    return NextResponse.json({ error: '建立失敗' }, { status: 500 })
  }
})
