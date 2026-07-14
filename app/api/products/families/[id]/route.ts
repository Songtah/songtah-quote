// GET /api/products/families/[id]
// Returns { family: ProductFamily, members: { code, name, brand, category, productType }[] }
// members = union of (skuMap values | prefix-matched | coveredSkuCodes) + Notion-assigned
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCatalog } from '@/lib/products-catalog'
import { getManagedFamilyById } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export const GET = withApiAuth<Ctx>('session', async (_req, { params }) => {
  const family = await getManagedFamilyById(params.id)
  if (!family) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

  const catalog = getCatalog()
  const codeSet = new Set(explicitFamilySkuCodes(family))

  // Build member list from catalog
  const codeMap = new Map(catalog.map((p) => [p.code, p]))
  const members = Array.from(codeSet).map((code) => {
    const p = codeMap.get(code)
    return p
      ? { code: p.code, name: p.name, brand: p.brand, category: p.category, productType: p.productType }
      : { code, name: code, brand: family.brand, category: family.category, productType: family.productType }
  })

  return NextResponse.json({ family, members })
})
