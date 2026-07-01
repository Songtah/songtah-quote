/**
 * lib/order-pricing.ts — 訂單促銷定價/驗證引擎（純函式，無 I/O）
 *
 * 單一真實來源：前端 OrderForm 即時預覽與後端權威驗證都用這裡的規則，公式一致。
 * 後端把關政策（使用者選定）：**驗證所有促銷帶價**——
 *   - 手動、非促銷的單價：放行（業務議價，屬既有功能，另有報價審批把關）。
 *   - 促銷自動帶的價格（single_price / add_on / fixed_set_price / series_discount /
 *     qty_discount）：必須等於依真實促銷重算的結果，否則違規。
 *   - 免費品項（gift / sample，0 元）：必須由真實促銷授權（buy_a_get_b / buy_n_get_m /
 *     series_buy_n_get_m），且數量不超過應得贈品量，否則違規（此為「免費拿貨」的核心防線）。
 *
 * 規則對應 components/OrderForm.tsx 的 matchPromoItem / applyPromoCondition /
 * handleQtyChange / seriesBuyNGetMStatus，務必與前端一致。
 */

export type PricingItemType = 'normal' | 'gift' | 'sample'

/** 引擎所需的最小訂單行欄位（前端 OrderItem 的子集） */
export interface PricingLine {
  skuCode: string
  seriesId?: string
  quantity: number
  unitPrice: number
  baseUnitPrice?: number       // rate 型折扣的折前定價快照
  itemType?: PricingItemType
}

/** 引擎所需的最小促銷品項欄位（PromotionItem 的子集，僅取 status='已確認' 者） */
export interface PromoRule {
  skuCode?: string
  seriesId?: string
  conditionType?: string | null
  conditionParams?: any
}

export interface PromoViolation {
  index: number        // 對應 lines 的索引
  skuCode: string
  reason: string
}

// 系列級促銷：才允許用 seriesId 比對；其餘一律只認 skuCode（避免同系列其他產品被誤觸發）
const SERIES_CONDITION_TYPES = new Set(['series_discount', 'series_buy_n_get_m'])

function isGift(it: PricingLine): boolean {
  return it.itemType === 'gift' || it.itemType === 'sample'
}

/** 類型感知比對：skuCode 精準優先；seriesId 只比對系列級促銷。與前端 matchPromoItem 一致。 */
export function matchPromoRule(
  item: { skuCode?: string; seriesId?: string },
  rules: PromoRule[],
): PromoRule | undefined {
  if (item.skuCode) {
    const bySku = rules.find((p) => p.skuCode && p.skuCode === item.skuCode)
    if (bySku) return bySku
  }
  if (item.seriesId) {
    return rules.find(
      (p) => p.seriesId && p.seriesId === item.seriesId &&
             SERIES_CONDITION_TYPES.has(p.conditionType as string),
    )
  }
  return undefined
}

/** 買N送M 應得贈品量：floor(orderQty / n) * m。與前端 calcBuyNGetMGiftQty 一致。 */
export function buyNGetMGiftQty(orderQty: number, n: number, m: number): number {
  if (!n || !m || n <= 0) return 0
  return Math.floor(orderQty / n) * m
}

/**
 * 依真實促銷重算「某一般購買行」的權威促銷單價。
 * 回傳 number = 促銷強制的價格（需驗證）；回傳 null = 此行不受促銷帶價，允許手動價。
 * catalogPriceOf：注入的目錄價解析器（rate 型折扣用來防止灌高折前基準）；無則略過基準比對。
 */
export function expectedPromoUnitPrice(
  line: PricingLine,
  rule: PromoRule | undefined,
  catalogPriceOf?: (skuCode: string) => number | null,
): number | null {
  if (!rule?.conditionType) return null
  const p = rule.conditionParams as any

  switch (rule.conditionType) {
    case 'single_price':
      return p?.price != null ? Number(p.price) : null

    case 'add_on':
      return p?.addOnPrice != null ? Number(p.addOnPrice) : null

    case 'fixed_set_price': {
      // 只有數量剛好等於某 tier 時才帶價（與前端一致）；否則不強制。
      const tier = (p?.tiers ?? []).find((t: any) => t.qty === line.quantity)
      return tier ? Math.round(tier.totalPrice / tier.qty) : null
    }

    case 'series_discount': {
      if (p?.rate == null) return null
      const base = baseForRate(line, catalogPriceOf)
      if (base == null || base <= 0) return null   // 無折前基準（尚未定價）→ 不強制
      return Math.round(base * p.rate)
    }

    case 'qty_discount': {
      const applicable = (p?.tiers ?? [])
        .filter((t: any) => line.quantity >= t.minQty)
        .sort((a: any, b: any) => b.minQty - a.minQty)[0]
      if (!applicable) return null
      if (applicable.price != null) return Number(applicable.price)
      if (applicable.rate != null) {
        const base = baseForRate(line, catalogPriceOf)
        if (base == null || base <= 0) return null
        return Math.round(base * applicable.rate)
      }
      return null
    }

    // 這些不「帶價」（買N送M/系列/組合的效果是贈品或另行處理），一般行不強制單價
    case 'buy_n_get_m':
    case 'series_buy_n_get_m':
    case 'buy_a_get_b':
    case 'bundle':
    default:
      return null
  }
}

/** rate 型折扣的折前基準：以目錄價為準（防灌高）；目錄無價時退回行內 baseUnitPrice 快照。 */
function baseForRate(line: PricingLine, catalogPriceOf?: (skuCode: string) => number | null): number | null {
  const cat = catalogPriceOf?.(line.skuCode)
  if (cat != null && cat > 0) return cat
  return line.baseUnitPrice ?? null
}

/**
 * 驗證整張訂單的促銷帶價與贈品是否成立。回傳違規清單（空=通過）。
 * lines：送單品項；rules：該訂單 promotionId 對應、status='已確認' 的促銷品項。
 */
export function validateOrderPromotions(
  lines: PricingLine[],
  rules: PromoRule[],
  catalogPriceOf?: (skuCode: string) => number | null,
): PromoViolation[] {
  const violations: PromoViolation[] = []

  // ── 一般購買行：驗證促銷帶的單價 ──────────────────────────────────────────
  lines.forEach((line, index) => {
    if (isGift(line)) return
    const rule = matchPromoRule(line, rules)
    const expected = expectedPromoUnitPrice(line, rule, catalogPriceOf)
    if (expected != null && line.unitPrice !== expected) {
      violations.push({
        index, skuCode: line.skuCode,
        reason: `促銷單價不符：應為 NT$${expected.toLocaleString()}（送出 NT$${Number(line.unitPrice).toLocaleString()}）`,
      })
    }
  })

  // ── 免費品項（gift/sample）：必須由促銷授權，且數量不超過應得 ─────────────
  // 先算各促銷授權的贈品「額度」，再逐一核銷 gift 行。
  const giftLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isGift(line))

  if (giftLines.length > 0) {
    // 應得贈品額度：key=skuCode（買A送B／買N送M）；系列贈品另以 seriesId 記。
    const entitledBySku: Record<string, number> = {}
    const entitledBySeries: Record<string, number> = {}

    for (const rule of rules) {
      const p = rule.conditionParams as any
      if (rule.conditionType === 'buy_a_get_b' && p?.giftSkuCode) {
        // 主商品（rule.skuCode）有在訂單且數量>0 → 授權 giftQty 個 giftSkuCode
        const mainQty = totalNormalQtyOfSku(lines, rule.skuCode)
        if (mainQty > 0) {
          entitledBySku[p.giftSkuCode] = (entitledBySku[p.giftSkuCode] ?? 0) + (p.giftQty ?? 1)
        }
      } else if (rule.conditionType === 'buy_n_get_m' && rule.skuCode && p?.n && p?.m) {
        const mainQty = totalNormalQtyOfSku(lines, rule.skuCode)
        entitledBySku[rule.skuCode] = (entitledBySku[rule.skuCode] ?? 0) + buyNGetMGiftQty(mainQty, p.n, p.m)
      } else if (rule.conditionType === 'series_buy_n_get_m' && rule.seriesId && p?.n && p?.m) {
        const seriesQty = totalNormalQtyOfSeries(lines, rule.seriesId)
        entitledBySeries[rule.seriesId] = (entitledBySeries[rule.seriesId] ?? 0) + buyNGetMGiftQty(seriesQty, p.n, p.m)
      }
    }

    // 逐一核銷（同 sku/series 的多張 gift 行合計不可超過額度）
    const usedBySku: Record<string, number> = {}
    const usedBySeries: Record<string, number> = {}
    for (const { line, index } of giftLines) {
      const qty = line.quantity || 0
      const skuAllow = entitledBySku[line.skuCode] ?? 0
      const seriesAllow = line.seriesId ? (entitledBySeries[line.seriesId] ?? 0) : 0

      // 優先用 sku 額度（買A送B/買N送M），不足再用系列額度（series_buy_n_get_m 自選贈品）
      const usedSku = usedBySku[line.skuCode] ?? 0
      const skuRemain = Math.max(0, skuAllow - usedSku)
      const takeFromSku = Math.min(qty, skuRemain)
      let remaining = qty - takeFromSku
      usedBySku[line.skuCode] = usedSku + takeFromSku

      if (remaining > 0 && line.seriesId) {
        const usedSeries = usedBySeries[line.seriesId] ?? 0
        const seriesRemain = Math.max(0, seriesAllow - usedSeries)
        const takeFromSeries = Math.min(remaining, seriesRemain)
        remaining -= takeFromSeries
        usedBySeries[line.seriesId] = usedSeries + takeFromSeries
      }

      if (remaining > 0) {
        violations.push({
          index, skuCode: line.skuCode,
          reason: `免費品項未由促銷授權或超過應得贈品量（超出 ${remaining} 件）`,
        })
      }
    }
  }

  return violations
}

function totalNormalQtyOfSku(lines: PricingLine[], skuCode?: string): number {
  if (!skuCode) return 0
  return lines
    .filter((it) => !isGift(it) && it.skuCode === skuCode)
    .reduce((sum, it) => sum + (it.quantity || 0), 0)
}

function totalNormalQtyOfSeries(lines: PricingLine[], seriesId?: string): number {
  if (!seriesId) return 0
  return lines
    .filter((it) => !isGift(it) && it.seriesId === seriesId)
    .reduce((sum, it) => sum + (it.quantity || 0), 0)
}
