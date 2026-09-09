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

    // 中央管理／admin 的 session 沒有對應的「業務人員」值，用它當範圍會永遠是空的。
    // 主管沒指定業務時 → 彙總全體業務的名單，各筆標明是誰的。
    if (canViewAll && !sp.get('salesperson')) {
      const each = await Promise.all(
        salespeople.map((name) => buildVisitSuggestions({ mode, city, district, salesperson: name, limit: 500 })
          .catch(() => null))
      )
      const merged = each.flatMap((r, i) => (r?.items ?? []).map((it) => ({ ...it, owner: salespeople[i] })))
      merged.sort((a, b) => b.score - a.score)
      const byKind = { overdue: 0, hot: 0, stale: 0, newOpening: 0 } as Record<string, number>
      for (const it of merged) byKind[it.kind]++
      return NextResponse.json({
        mode, items: merged.slice(0, limit), total: merged.length, byKind,
        scope: `全體業務（${salespeople.length} 位）`,
        builtAt: '', salespeople, viewingAll: true,
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
