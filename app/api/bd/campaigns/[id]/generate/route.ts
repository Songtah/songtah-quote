/**
 * POST /api/bd/campaigns/[id]/generate — 智慧產生潛在購買名單候選(第二階段)
 *
 * 三種來源(route 層組合 orders/visits/catalog/customers 領域,只讀不寫):
 *   cross-sell     交叉銷售:買過「同系列/同分類/同品牌」其他產品、但沒買過目標 SKU 的客戶
 *   visit-interest 拜訪興趣:客情紀錄「有興趣的產品」或內容含關鍵字的客戶
 *   competitor     競品使用:客情紀錄「競品」欄含指定競品的客戶
 *
 * body: { source, scope?('series'|'category'|'brand'), keyword?, competitor? }
 * 回傳候選(排除已在名單者,附推薦理由),純預覽——匯入由使用者在 UI 勾選後另行呼叫 members。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listMembers } from '@/lib/notion/campaigns'
import { listCampaigns } from '@/lib/notion/campaigns'
import { getAllSystemCustomers } from '@/lib/notion/customers'
import { listOrders } from '@/lib/orders-notion'
import { listVisits } from '@/lib/notion/visits'
import { getCatalogProduct, getFamilyByCode } from '@/lib/products-catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CAP = 300
const nid = (s: string) => (s ?? '').replace(/-/g, '')

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }) => {
  try {
    const b = await req.json()
    const source: string = b.source

    const campaigns = await listCampaigns()
    const campaign = campaigns.find((c) => nid(c.id) === nid(params.id))
    if (!campaign) return NextResponse.json({ error: '找不到名單' }, { status: 404 })

    const [members, allCustomers] = await Promise.all([listMembers(campaign.id), getAllSystemCustomers()])
    const already = new Set(members.map((m) => nid(m.customerId)))
    const custById = new Map(allCustomers.map((c) => [nid(c.id), c]))

    type Candidate = { customerId: string; name: string; salesperson: string; area: string; reason: string }
    const out = new Map<string, Candidate>() // key = nid(customerId)

    const push = (customerId: string, reason: string) => {
      const k = nid(customerId)
      if (!k || already.has(k) || out.has(k)) return
      const c = custById.get(k)
      if (!c) return
      out.set(k, {
        customerId, name: c.name, salesperson: c.salesperson,
        area: [c.city, c.district].filter(Boolean).join(''), reason,
      })
    }

    if (source === 'cross-sell') {
      if (campaign.targetSkus.length === 0) {
        return NextResponse.json({ error: '此名單未設目標 SKU,無法交叉銷售比對(編輯名單補上目標 SKU)' }, { status: 400 })
      }
      const scope: 'series' | 'category' | 'brand' = b.scope ?? 'series'
      // 由第一個目標 SKU 推出關聯範圍
      const ref = getCatalogProduct(campaign.targetSkus[0])
      const family = getFamilyByCode(campaign.targetSkus[0])
      const inScope = (sku: string): boolean => {
        if (!sku) return false
        if (scope === 'series') return !!family && sku.startsWith(family.seriesCode)
        const p = getCatalogProduct(sku)
        if (!p || !ref) return false
        return scope === 'category' ? p.category === ref.category : p.brand === ref.brand
      }
      if (scope === 'series' && !family) {
        return NextResponse.json({ error: `目標 SKU ${campaign.targetSkus[0]} 找不到所屬系列,改用「同分類/同品牌」` }, { status: 400 })
      }
      const targetSet = new Set(campaign.targetSkus)
      const orders = (await listOrders()).filter((o) => o.status !== '已取消' && o.customerId)
      // 先找出已買過目標者(排除),再收「買過範圍內其他品」者
      const boughtTarget = new Set<string>()
      for (const o of orders) if (o.items.some((it) => targetSet.has(it.skuCode))) boughtTarget.add(nid(o.customerId))
      for (const o of orders) {
        const k = nid(o.customerId)
        if (boughtTarget.has(k)) continue
        const hit = o.items.find((it) => inScope(it.skuCode) && !targetSet.has(it.skuCode))
        if (hit) push(o.customerId, `買過${scope === 'series' ? '同系列' : scope === 'category' ? '同分類' : '同品牌'}:${hit.skuName || hit.skuCode}(${o.date})`)
      }
    } else if (source === 'visit-interest') {
      const keyword = (b.keyword ?? campaign.product ?? '').trim()
      if (!keyword) return NextResponse.json({ error: '請提供關鍵字' }, { status: 400 })
      const { items: visits } = await listVisits({ fetchAll: true })
      for (const v of visits) {
        if (!v.customerId) continue
        const prodHit = v.interestedProducts.find((p) => p.name.includes(keyword))
        const contentHit = !prodHit && v.content.includes(keyword)
        if (prodHit || contentHit) {
          push(v.customerId, `${v.date} 拜訪${prodHit ? `對「${prodHit.name}」表達興趣` : `內容提及「${keyword}」`}${v.customerReaction ? `(${v.customerReaction})` : ''}`)
        }
      }
    } else if (source === 'competitor') {
      const competitor = (b.competitor ?? '').trim()
      if (!competitor) return NextResponse.json({ error: '請選擇競品' }, { status: 400 })
      const { items: visits } = await listVisits({ fetchAll: true })
      for (const v of visits) {
        if (!v.customerId) continue
        if (v.competitorEquipment.includes(competitor)) {
          push(v.customerId, `${v.date} 拜訪記錄使用競品「${competitor}」${v.customerReaction ? `(${v.customerReaction})` : ''}`)
        }
      }
    } else {
      return NextResponse.json({ error: '未知的來源' }, { status: 400 })
    }

    const candidates = Array.from(out.values())
    return NextResponse.json({
      total: candidates.length,
      capped: candidates.length > CAP,
      candidates: candidates.slice(0, CAP),
    })
  } catch (error) {
    console.error('generate error:', error)
    return NextResponse.json({ error: '產生候選失敗' }, { status: 500 })
  }
})
