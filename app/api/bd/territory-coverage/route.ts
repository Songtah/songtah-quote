/**
 * GET /api/bd/territory-coverage
 *
 * 回傳「目前使用者可見轄區」各行政區的認領覆蓋率：已認領 / 尚未認領 / 合計。
 *
 * 為什麼獨立成一支 API：轄區面板的卡片數字來自 BAS 市場快照（本機 JSON，很快），
 * 這裡要另外掃 Notion 客戶庫，業務若有上百個轄區會慢好幾秒。做成獨立端點讓前端
 * 延遲載入，面板可以先顯示、覆蓋數字後到，載入失敗也不影響原有功能。
 */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listTerritories } from '@/lib/notion/territories'
import { listCustomersByAreas } from '@/lib/notion/customers'
import { getCachedValue, setCachedValue } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INACTIVE_STATUS = new Set(['已歇業', '停業', '撤銷'])

type Coverage = {
  city: string
  district: string
  total: number
  claimed: number
  unclaimed: number
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (_req, _ctx, session) => {
  try {
    const user = session.user as any
    const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'

    const allTerritories = await listTerritories()
    const territories = canViewAll
      ? allTerritories
      : allTerritories.filter((item) => !!item.salespersonId && item.salespersonId === user?.id)
    if (territories.length === 0) return NextResponse.json({ items: [] })

    // 依可見範圍分開快取，避免業務讀到主管的全域結果
    const cacheKey = `territory-coverage:${canViewAll ? 'all' : user?.id ?? 'none'}`
    const cached = getCachedValue<Coverage[]>(cacheKey)
    if (cached) return NextResponse.json({ items: cached, cached: true })

    const areas = territories.map((item) => ({ city: item.city, district: item.district }))
    const customers = await listCustomersByAreas(areas)

    const map = new Map<string, Coverage>()
    for (const area of areas) {
      if (!area.city || !area.district) continue
      map.set(`${area.city}|${area.district}`, {
        city: area.city, district: area.district, total: 0, claimed: 0, unclaimed: 0,
      })
    }
    for (const customer of customers) {
      if (INACTIVE_STATUS.has(customer.status)) continue
      const entry = map.get(`${customer.city}|${customer.district}`)
      if (!entry) continue
      entry.total++
      if ((customer.salesperson ?? '').trim()) entry.claimed++
      else entry.unclaimed++
    }

    const items = Array.from(map.values())
    setCachedValue(cacheKey, items, 60_000)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('bd territory-coverage GET error:', error)
    return NextResponse.json({ error: '讀取轄區覆蓋狀況失敗' }, { status: 500 })
  }
})
