import { getAllFamilies, getCatalog, type ProductFamily } from '@/lib/products-catalog'
import { listFamilyAssignments } from '@/lib/products-notion'
import { listSeriesRecords } from '@/lib/products-series-notion'

export interface ManagedProductFamily extends ProductFamily {
  coveredSkuCodes?: string[]
  manualAssignedSkuCodes?: string[]
  source?: 'catalog' | 'notion'
}

function customFamilyId(seriesCode: string): string {
  return `custom:${seriesCode}`
}

/**
 * Compose deployed family definitions with Notion-managed names and memberships.
 * Manual assignments override deployed membership, so a SKU appears in one family only.
 */
export async function getManagedFamilies(strict = false): Promise<ManagedProductFamily[]> {
  const catalogFamilies = getAllFamilies()
  const [seriesResult, assignmentResult] = await Promise.allSettled([
    listSeriesRecords(),
    listFamilyAssignments(),
  ])
  if (strict && (seriesResult.status === 'rejected' || assignmentResult.status === 'rejected')) {
    throw new Error('產品系列管理資料暫時無法完整讀取')
  }
  const seriesRecords = seriesResult.status === 'fulfilled' ? seriesResult.value : []
  const assignments = assignmentResult.status === 'fulfilled' ? assignmentResult.value : []
  const seriesByCode = new Map(seriesRecords.map((record) => [record.seriesCode, record]))
  const validFamilyIds = new Set([
    ...catalogFamilies.map((family) => family.id),
    ...seriesRecords
      .filter((record) => record.seriesCode && !catalogFamilies.some((family) => family.seriesCode === record.seriesCode))
      .map((record) => customFamilyId(record.seriesCode)),
  ])
  const validAssignments = assignments.filter((item) => validFamilyIds.has(item.familyId))
  const assignedFamilyBySku = new Map(validAssignments.map((item) => [item.skuCode, item.familyId]))

  const families: ManagedProductFamily[] = catalogFamilies.map((family) => {
    const series = seriesByCode.get(family.seriesCode)
    const deployedCovered = (family as ManagedProductFamily).coveredSkuCodes ?? []
    const filteredSkuMap = family.skuMap
      ? Object.fromEntries(Object.entries(family.skuMap).filter(([, sku]) => !assignedFamilyBySku.has(sku)))
      : undefined
    return {
      ...family,
      seriesName: series?.seriesName || family.seriesName,
      brand: series?.brand || family.brand,
      skuMap: filteredSkuMap,
      coveredSkuCodes: deployedCovered.filter((sku) => !assignedFamilyBySku.has(sku)),
      manualAssignedSkuCodes: [],
      source: 'catalog',
    }
  })

  const familyById = new Map(families.map((family) => [family.id, family]))
  const catalogByCode = new Map(getCatalog().map((product) => [product.code, product]))

  for (const record of seriesRecords) {
    if (catalogFamilies.some((family) => family.seriesCode === record.seriesCode)) continue
    const id = customFamilyId(record.seriesCode)
    const family: ManagedProductFamily = {
      id,
      seriesCode: record.seriesCode,
      seriesName: record.seriesName || record.seriesCode,
      brand: record.brand,
      productType: '',
      category: '',
      skuPattern: '',
      namePattern: '',
      specs: [],
      coveredSkuCodes: [],
      manualAssignedSkuCodes: [],
      source: 'notion',
    }
    families.push(family)
    familyById.set(id, family)
  }

  for (const assignment of validAssignments) {
    const family = familyById.get(assignment.familyId)
    if (!family) continue
    family.coveredSkuCodes = [...(family.coveredSkuCodes ?? []), assignment.skuCode]
    family.manualAssignedSkuCodes = [...(family.manualAssignedSkuCodes ?? []), assignment.skuCode]
    const product = catalogByCode.get(assignment.skuCode)
    if (product && !family.productType) family.productType = product.productType
    if (product && !family.category) family.category = product.category
    if (product && !family.brand) family.brand = product.brand
  }

  return families
}

export async function getManagedFamilyById(id: string, strict = false): Promise<ManagedProductFamily | undefined> {
  return (await getManagedFamilies(strict)).find((family) => family.id === id)
}
