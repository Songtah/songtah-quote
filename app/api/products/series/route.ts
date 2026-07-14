import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listSeriesRecords, createSeriesRecord, getSeriesByCode } from '@/lib/products-series-notion'
import { getAllFamilies } from '@/lib/products-catalog'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

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
export const POST = withApiAuth('central-management', async (req, _ctx, session) => {
  try {
    const body = await req.json()
    const seriesCode = typeof body.seriesCode === 'string' ? body.seriesCode.trim() : ''
    const seriesName = typeof body.seriesName === 'string' ? body.seriesName.trim() : ''
    const brand = typeof body.brand === 'string' ? body.brand.trim() : ''
    if (!seriesCode || !seriesName) {
      return NextResponse.json({ error: '系列代碼與系列名稱為必填' }, { status: 400 })
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,49}$/.test(seriesCode)) {
      return NextResponse.json({ error: '系列代碼限 2–50 碼英數字、句點、底線或連字號' }, { status: 400 })
    }
    const [records] = await Promise.all([listSeriesRecords()])
    const duplicate = records.some((record) => record.seriesCode.toLowerCase() === seriesCode.toLowerCase())
      || getAllFamilies().some((family) => family.seriesCode.toLowerCase() === seriesCode.toLowerCase())
    if (duplicate) return NextResponse.json({ error: '系列代碼已存在' }, { status: 409 })

    await createSeriesRecord({ seriesCode, seriesName, brand })
    const record = await getSeriesByCode(seriesCode)
    if (!record) throw new Error('系列建立後無法讀回')
    if (record.seriesCode !== seriesCode || record.seriesName !== seriesName || record.brand !== brand) {
      throw new Error('系列建立後讀回內容不一致')
    }
    await logAuditEvent({
      module: 'products',
      action: 'create',
      entityType: 'product-series',
      entityId: record.seriesCode,
      entityTitle: record.seriesName,
      summary: `建立產品系列：${record.seriesName}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      after: record,
    }).catch((error) => console.error('audit series create error:', error))
    return NextResponse.json(record)
  } catch (e: any) {
    console.error('POST /api/products/series error:', e)
    return NextResponse.json({ error: '建立失敗' }, { status: 500 })
  }
})
