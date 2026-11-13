/**
 * GET /api/products/detail?series=<系列 id>｜?code=<貨號>
 *
 * 產品專屬頁（/products/series/[id]、/products/item/[code]）的資料來源：
 * 只回該系列（或該單品）的成員，不必像產品總覽一次載入全目錄。
 * 非中央管理看不到已停售與暫停販售的品項（與 catalog-raw 相同規則）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { isCentralManagement } from '@/lib/permissions'
import { getEffectiveCatalog, getAvailableManagedFamilies } from '@/lib/products-availability'
import { getManagedFamilies } from '@/lib/products-managed-families'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'
import { listDisabledSkuCodes, listProductImageIndex } from '@/lib/products-notion'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('session', async (req: NextRequest, _ctx, session) => {
  const seriesId = req.nextUrl.searchParams.get('series') ?? ''
  const code = req.nextUrl.searchParams.get('code') ?? ''
  if (!seriesId && !code) return NextResponse.json({ error: '缺少 series 或 code' }, { status: 400 })

  const central = isCentralManagement(session)
  const [catalog, disabledCodes, families] = await Promise.all([
    getEffectiveCatalog(true),
    listDisabledSkuCodes(),
    central ? getManagedFamilies() : getAvailableManagedFamilies(),
  ])
  const disabled = new Set(disabledCodes)
  const byCode = new Map(catalog.map((item) => [item.code, item]))

  const family = seriesId
    ? families.find((item) => item.id === seriesId)
    : families.find((item) => explicitFamilySkuCodes(item).includes(code))
  if (seriesId && !family) return NextResponse.json({ error: '找不到這個系列' }, { status: 404 })

  const memberCodes = family ? explicitFamilySkuCodes(family) : [code]
  const members = memberCodes
    .map((memberCode) => byCode.get(memberCode))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => central || (!item.discontinued && !disabled.has(item.code)))
  if (members.length === 0) return NextResponse.json({ error: '找不到這個產品' }, { status: 404 })

  const imageIndex = await listProductImageIndex(Array.from(new Set(members.map((item) => item.brand || '__empty__'))))
  const items = members.map((item) => ({
    ...item,
    disabled: disabled.has(item.code),
    imageUrl: imageIndex[item.code] ?? '',
  }))

  return NextResponse.json({ family: family ?? null, items }, { headers: { 'Cache-Control': 'private, no-store' } })
})
