import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getTerritoryAreas } from '@/lib/territory-areas'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'clinic_monitor', action: 'view' }, async () => {
  try {
    const result = await getTerritoryAreas()
    return NextResponse.json({ ...result, source: 'medical-snapshot' })
  } catch (error) {
    console.error('territory areas GET error:', error)
    return NextResponse.json({ error: '讀取轄區選項失敗' }, { status: 500 })
  }
})
