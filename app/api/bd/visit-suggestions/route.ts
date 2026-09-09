/**
 * GET /api/bd/visit-suggestions — 拜訪建議(組合層 route)
 *
 * 參數:mode(today|area,預設 today)、limit(預設 20)、salesperson(預設登入者)
 *       city/district 只有 area 模式需要——today 模式的範圍是「名下客戶＋自己轄區內未認領者」，
 *       不要求使用者選任何東西（CLAUDE.md 最高原則：業務只回報，其餘系統處理）。
 * 回傳依訊號評分排序的單一清單，每筆帶 kind 與完整 reasons。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { buildVisitSuggestions } from '@/lib/notion/visit-suggestions'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const sp = req.nextUrl.searchParams
    const city = sp.get('city') ?? ''
    const district = sp.get('district') ?? ''
    const user = session.user as any
    const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理'
    const salesperson = canViewAll
      ? (sp.get('salesperson') || (session?.user?.name ?? ''))
      : (session?.user?.name ?? '')
    // 改版後不再有 A/B/C 配比，只有一份依訊號評分的排序清單
    const mode = sp.get('mode') === 'area' ? 'area' as const : 'today' as const
    if (mode === 'area' && (!city || !district)) {
      return NextResponse.json({ error: '指定區域模式需要選擇縣市與行政區' }, { status: 400 })
    }
    const limit = Math.min(50, Math.max(1, Number(sp.get('limit')) || 20))
    const users = await getSystemUsers()
    const salespeople = users
      .filter((a) => a.accountType === '業務' && a.status !== '停用')
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b, 'zh-TW'))

    // 環境變數／管理帳號的 session 沒有業務姓名，「今天該跑誰」對它沒有意義——
    // 回 200 加上業務清單讓主管自己選，而不是回 400 讓整頁壞掉。
    if (!salesperson) {
      return NextResponse.json({
        mode, items: [], total: 0,
        byKind: { overdue: 0, hot: 0, stale: 0, newOpening: 0 },
        scope: '這個帳號不是業務，請先選擇要查看哪一位業務的名單',
        builtAt: '', salespeople, needsSalesperson: true,
      })
    }

    const accountMatches = canViewAll
      ? users.filter((account) => account.name === salesperson)
      : users.filter((account) => account.id === user?.id)
    const existingOnly = accountMatches.length !== 1 || !canAcceptNewBusiness(accountMatches[0])

    const result = await buildVisitSuggestions({ mode, city, district, salesperson, limit, existingOnly })
    return NextResponse.json({ ...result, existingOnly, salespeople: canViewAll ? salespeople : undefined })
  } catch (error) {
    console.error('visit-suggestions error:', error)
    return NextResponse.json({ error: '產生拜訪建議失敗' }, { status: 500 })
  }
})
