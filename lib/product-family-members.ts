export interface FamilyMembershipSource {
  id: string
  skuMap?: Record<string, string>
  coveredSkuCodes?: string[]
}

/**
 * 系列歸屬只接受明確列出的 SKU。
 * 不使用 seriesCode prefix，避免同前綴的不同產品被錯併成同系列。
 */
export function explicitFamilySkuCodes(family: FamilyMembershipSource): string[] {
  return Array.from(new Set([
    ...Object.values(family.skuMap ?? {}),
    ...(family.coveredSkuCodes ?? []),
  ].filter(Boolean)))
}

/** SKU → familyId；同一 SKU 若出現在多個 family，視為衝突且不自動歸屬。 */
export function buildExactFamilyIndex(families: FamilyMembershipSource[]): {
  familyIdBySku: Map<string, string>
  conflictingSkus: Set<string>
} {
  const candidates = new Map<string, Set<string>>()

  for (const family of families) {
    for (const skuCode of explicitFamilySkuCodes(family)) {
      const familyIds = candidates.get(skuCode) ?? new Set<string>()
      familyIds.add(family.id)
      candidates.set(skuCode, familyIds)
    }
  }

  const familyIdBySku = new Map<string, string>()
  const conflictingSkus = new Set<string>()
  candidates.forEach((familyIds, skuCode) => {
    const familyId = Array.from(familyIds)[0]
    if (familyIds.size === 1 && familyId) familyIdBySku.set(skuCode, familyId)
    else conflictingSkus.add(skuCode)
  })

  return { familyIdBySku, conflictingSkus }
}
