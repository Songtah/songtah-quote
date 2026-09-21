/**
 * GET /api/admin/medical-monitor/code-not-found
 * 「有機構代碼但衛福部查無」的客戶清單（以代碼去重）。?refresh=1 才重算。
 * 這些多為未立案機構，與合法立案的管理主體分開呈現，不納入歇業判定。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCodeNotFoundList } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    const data = await getCodeNotFoundList({ refresh })
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('code-not-found error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
