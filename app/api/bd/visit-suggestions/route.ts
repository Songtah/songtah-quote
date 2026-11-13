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
import { buildVisitSuggestions, suggestionTimings } from '@/lib/notion/visit-suggestions'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { cachedSWR } from '@/lib/notion/shared'

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
    if (canViewAll && sp.get('timing') === '1') {   // 診斷：單一業務各步驟耗時，25 秒沒完成也回報已完成的部分
      for (const k of Object.keys(suggestionTimings)) delete suggestionTimings[k]
      const t0 = Date.now()
      const done = await Promise.race([buildVisitSuggestions({ mode, city, district, salesperson, limit }).then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 25_000))])
      return NextResponse.json({ totalMs: Date.now() - t0, finished: done, parts: { ...suggestionTimings } })
    }
    const users = await getSystemUsers()
    const salespeople = users
      .filter((a) => a.accountType === '業務' && a.status !== '停用')
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b, 'zh-TW'))

    // 中央管理／admin 的 session 沒有對應的「業務人員」值，用它當範圍會永遠是空的。
    // 主管沒指定業務時 → 彙總全體業務的名單，各筆標明是誰的。
    if (canViewAll && !sp.get('salesperson')) {
      // 全體業務：9 份並行計算，冷啟動要 20 秒以上；結果跨實例快取（5 分鐘內直接回，過期先回舊值、背景更新）
      const all = await cachedSWR(`visit-suggestions:all:v1:${mode}:${city}:${district}`, async () => {
      const each = await Promise.all(
        salespeople.map((name) => buildVisitSuggestions({ mode, city, district, salesperson: name, limit: 500 })
          .catch(() => null))
      )
      const merged = each.flatMap((r, i) => (r?.items ?? []).map((it) => ({ ...it, owner: salespeople[i] })))
      merged.sort((a, b) => b.score - a.score)
      const byKind = { overdue: 0, hot: 0, stale: 0, newOpening: 0, event: 0 } as Record<string, number>
      for (const it of merged) byKind[it.kind]++
      return { merged: merged.slice(0, 50), total: merged.length, byKind }   // 只存前 50 筆（畫面最多取 50），控制快取大小
      }, { freshMs: 5 * 60_000, maxAgeMs: 6 * 60 * 60_000 })
      const { merged, total, byKind } = all
      return NextResponse.json({
        mode, items: merged.slice(0, limit), total, byKind,
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
