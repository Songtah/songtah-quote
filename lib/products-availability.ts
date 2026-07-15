import { explicitFamilySkuCodes } from '@/lib/product-family-members'
import { getCatalog, type CatalogProduct } from '@/lib/products-catalog'
import { getManagedFamilies, type ManagedProductFamily } from '@/lib/products-managed-families'
import { listDisabledSkuCodes, listProductPriceOverrides } from '@/lib/products-notion'

export interface AvailableProductFamily extends ManagedProductFamily {
  unavailableSkuCodes?: string[]
}

export interface EffectiveCatalogProduct extends CatalogProduct {
  basePrice: number | null
  priceSource: 'override' | 'catalog' | 'unset'
}

/** Static discontinued rows and central-management overrides share one picker exclusion set. */
export async function getUnavailableSkuCodes(refresh = false): Promise<Set<string>> {
  const unavailable = new Set(
    getCatalog()
      .filter((product) => product.discontinued)
      .map((product) => product.code),
  )
  for (const skuCode of await listDisabledSkuCodes(refresh)) unavailable.add(skuCode)
  return unavailable
}

export async function getEffectiveCatalog(includeUnavailable = false): Promise<EffectiveCatalogProduct[]> {
  const [unavailable, overrides] = await Promise.all([
    includeUnavailable ? Promise.resolve<Set<string> | null>(null) : getUnavailableSkuCodes(),
    listProductPriceOverrides(),
  ])
  return getCatalog()
    .filter((product) => includeUnavailable || !unavailable?.has(product.code))
    .map((product) => {
      const override = overrides[product.code]
      return {
        ...product,
        basePrice: product.price ?? null,
        price: override ?? product.price,
        priceSource: override != null ? 'override' : product.price != null ? 'catalog' : 'unset',
      }
    })
}

export async function getAvailableCatalog(): Promise<EffectiveCatalogProduct[]> {
  return getEffectiveCatalog(false)
}

function filterFamily(
  family: ManagedProductFamily,
  unavailable: Set<string>,
  catalog: CatalogProduct[],
): AvailableProductFamily | null {
  const explicitBefore = new Set(explicitFamilySkuCodes(family))
  const skuMap = family.skuMap
    ? Object.fromEntries(Object.entries(family.skuMap).filter(([, code]) => !unavailable.has(code)))
    : undefined
  const coveredSkuCodes = (family.coveredSkuCodes ?? []).filter((code) => !unavailable.has(code))
  const manualAssignedSkuCodes = (family.manualAssignedSkuCodes ?? []).filter((code) => !unavailable.has(code))
  const unavailableSkuCodes = Array.from(unavailable).filter((code) =>
    explicitBefore.has(code) || (explicitBefore.size === 0 && code.startsWith(family.seriesCode)),
  )
  const filtered: AvailableProductFamily = {
    ...family,
    skuMap,
    coveredSkuCodes,
    manualAssignedSkuCodes,
    unavailableSkuCodes,
  }

  const hasExplicitMember = explicitFamilySkuCodes(filtered).length > 0
  const hasPatternMember = Boolean(family.skuPattern) && catalog.some(
    (product) => product.code.startsWith(family.seriesCode) && !unavailable.has(product.code),
  )
  return hasExplicitMember || hasPatternMember ? filtered : null
}

export async function getAvailableManagedFamilies(): Promise<AvailableProductFamily[]> {
  const [families, unavailable] = await Promise.all([
    getManagedFamilies(),
    getUnavailableSkuCodes(),
  ])
  const catalog = getCatalog()
  return families
    .map((family) => filterFamily(family, unavailable, catalog))
    .filter((family): family is AvailableProductFamily => family !== null)
}
