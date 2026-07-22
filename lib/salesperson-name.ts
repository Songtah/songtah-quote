const LEGACY_TO_CANONICAL: Record<string, string> = {
  Dancan: 'Duncan',
}

/** 將客戶主檔的舊業務名稱轉成目前帳號顯示名稱。 */
export function canonicalSalespersonName(name: string): string {
  return LEGACY_TO_CANONICAL[name] ?? name
}

/** 查詢時同時相容目前正式名稱與可能殘留的舊名稱。 */
export function salespersonNameVariants(name: string): string[] {
  const canonical = canonicalSalespersonName(name)
  const legacy = Object.entries(LEGACY_TO_CANONICAL)
    .filter(([, current]) => current === canonical)
    .map(([old]) => old)
  return Array.from(new Set([canonical, ...legacy]))
}
