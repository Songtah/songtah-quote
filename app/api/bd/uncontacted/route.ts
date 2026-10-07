/**
 * GET /api/bd/uncontacted — 未往來名單（客戶主檔已建檔、公司從未往來）
 *
 * 定義見 lib/notion/uncontacted.ts（與市場監控頁「未曾往來」同一份）。
 * 權限：業務開發模組可看。主管（admin／中央管理／總經理）看全部；其他人只看自己名下。
 * query：type, city, district, owner（'__unassigned__'＝未分派、或業務名）, minHeadcount, q, limit
 * 回傳只含識別與規模欄位，不含地址／電話（未認領名單保密）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listUncontacted, type UncontactedRow } from '@/lib/notion/uncontacted'
import { salespersonNameVariants } from '@/lib/salesperson-name'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MANAGER_TYPES = ['中央管理', '總經理']
const UNASSIGNED = '__unassigned__'

function count<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, number>()
  for (const r of rows) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1) }
  return Array.from(m, ([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n)
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const user = session.user as any
    const isManager = user?.role === 'admin' || MANAGER_TYPES.includes(user?.accountType)
    const sp = req.nextUrl.searchParams
    const type = sp.get('type') ?? ''
    const city = sp.get('city') ?? ''
    const district = sp.get('district') ?? ''
    const owner = sp.get('owner') ?? ''
    const minHeadcount = Number(sp.get('minHeadcount') ?? 0) || 0
    const q = (sp.get('q') ?? '').trim()
    const limit = Math.min(Number(sp.get('limit') ?? 300) || 300, 1000)

    const { items, activeTotal, engagedTotal, visitedAvailable } = await listUncontacted()

    // 可見範圍：主管全部；業務只看自己名下
    const mine = new Set(salespersonNameVariants(user?.name ?? ''))
    const scope: UncontactedRow[] = isManager ? items : items.filter((r) => mine.has(r.salesperson))

    const byOwner = (r: UncontactedRow) =>
      !owner ? true : owner === UNASSIGNED ? !r.salesperson : r.salesperson === owner
    // facets：各維度在「其他條件」下的計數，讓篩選器數字跟著連動
    const base = scope.filter((r) =>
      (!q || r.name.includes(q)) && r.headcount >= minHeadcount && byOwner(r))
    const typeFacet = count(base.filter((r) => !city || r.city === city), (r) => r.type)
    const cityFacet = count(base.filter((r) => !type || r.type === type), (r) => r.city || '(未填縣市)')
    const districtFacet = city
      ? count(base.filter((r) => r.city === city && (!type || r.type === type)), (r) => r.district || '(未填行政區)')
      : []
    const ownerFacet = isManager
      ? count(scope.filter((r) => (!type || r.type === type) && (!city || r.city === city)), (r) => r.salesperson || UNASSIGNED)
      : []

    const filtered = base
      .filter((r) => (!type || r.type === type) && (!city || r.city === city) && (!district || r.district === district))
      .sort((a, b) => b.headcount - a.headcount || a.city.localeCompare(b.city) || a.district.localeCompare(b.district) || a.name.localeCompare(b.name))

    const assignTargets = isManager
      ? (await getSystemUsers()).filter(canAcceptNewBusiness).map((u) => u.name)
      : []

    return NextResponse.json({
      isManager, visitedAvailable,
      activeTotal, engagedTotal, uncontactedTotal: items.length, scopeTotal: scope.length,
      matched: filtered.length,
      items: filtered.slice(0, limit),
      facets: { type: typeFacet, city: cityFacet, district: districtFacet, owner: ownerFacet },
      assignTargets,
    })
  } catch (error) {
    console.error('uncontacted error:', error)
    return NextResponse.json({ error: '讀取未往來名單失敗' }, { status: 500 })
  }
})
