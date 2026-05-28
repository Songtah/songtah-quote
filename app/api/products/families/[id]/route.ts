// GET /api/products/families/[id]
// Returns { family: ProductFamily, members: { code, name, brand, category, productType }[] }
// members = union of (skuMap values | prefix-matched | coveredSkuCodes) + Notion-assigned
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAllFamilies, getCatalog } from '@/lib/products-catalog'
import { listSkusByFamilyId } from '@/lib/products-notion'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const family = getAllFamilies().find((f) => f.id === params.id)
  if (!family) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

  const catalog = getCatalog()
  const codeSet = new Set<string>()

  // From skuMap
  if (family.skuMap) {
    Object.values(family.skuMap).forEach((c) => codeSet.add(c))
  } else {
    // From prefix pattern
    catalog.filter((p) => p.code.startsWith(family.seriesCode)).forEach((p) => codeSet.add(p.code))
  }

  // From coveredSkuCodes
  ;(family as any).coveredSkuCodes?.forEach((c: string) => codeSet.add(c))

  // From Notion manual assignments
  const notionCodes = await listSkusByFamilyId(family.id).catch(() => [])
  notionCodes.forEach((c) => codeSet.add(c))

  // Build member list from catalog
  const codeMap = new Map(catalog.map((p) => [p.code, p]))
  const members = Array.from(codeSet).map((code) => {
    const p = codeMap.get(code)
    return p
      ? { code: p.code, name: p.name, brand: p.brand, category: p.category, productType: p.productType }
      : { code, name: code, brand: family.brand, category: family.category, productType: family.productType }
  })

  return NextResponse.json({ family, members })
}
