#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GENERATOR_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(GENERATOR_PATH), '..')
const CATALOG_PATH = resolve(ROOT, 'public/products_catalog.json')
const FAMILIES_PATH = resolve(ROOT, 'public/product_families.json')
const WRITE_MODE = process.argv.includes('--write')
const VERSION = '2026-07-14.v1'

const PRODUCT_KINDS = [
  'equipment',
  'material',
  'consumable',
  'durable_tool',
  'accessory',
  'spare_part',
  'software_license',
  'service',
  'other_review',
]

// Every legacy category must have exactly one baseline mapping. More specific,
// evidence-based 3D rules below may override it without touching source data.
const CATEGORY_MAPPING = {
  '3D列印機':              ['additive-manufacturing', '3d-printer', 'equipment'],
  '3D列印機配件':          ['additive-manufacturing', 'printer-accessory', 'accessory'],
  'PMMA 塊':               ['digital-manufacturing', 'pmma-blank', 'material'],
  '光固化機':              ['lab-equipment', 'light-curing-equipment', 'equipment'],
  '光學設備':              ['lab-equipment', 'optical-equipment', 'equipment'],
  '其他':                  ['other-review', 'uncategorized', 'other_review', true],
  '其他工具':              ['clinical-tools', 'other-tool', 'durable_tool', true],
  '其他材料':              ['lab-production', 'other-material', 'material', true],
  '其他設備':              ['lab-equipment', 'other-equipment', 'equipment', true],
  '切片':                  ['lab-production', 'cutting-disc', 'consumable', true],
  '切片 / 鋸片':           ['lab-production', 'cutting-disc', 'consumable'],
  '包埋 / 石膏':           ['lab-production', 'investment-gypsum', 'material'],
  '印模材料':              ['removable-prosthetics', 'impression-material', 'material'],
  '咬合器':                ['clinical-tools', 'articulator', 'equipment'],
  '咬合器 / 配件':         ['clinical-tools', 'articulator-accessory', 'accessory'],
  '塑鋼牙':                ['removable-prosthetics', 'acrylic-teeth', 'material'],
  '壓鑄 / 鑄造機':         ['lab-production', 'casting-pressing-equipment', 'equipment'],
  '套裝組':                ['other-review', 'kit-bundle', 'other_review', true],
  '專用液 / 藥劑':         ['lab-production', 'process-liquid', 'consumable'],
  '工具':                  ['clinical-tools', 'general-tool', 'durable_tool', true],
  '技工桌':                ['lab-equipment', 'workbench', 'equipment'],
  '拋光 / 研磨':           ['lab-production', 'polishing-consumable', 'consumable'],
  '掃描儀':                ['digital-manufacturing', 'scanner', 'equipment'],
  '染液 - 內染':           ['color-characterization', 'internal-stain', 'material'],
  '染液 - 外染':           ['color-characterization', 'external-stain', 'material'],
  '植體配件':              ['clinical-tools', 'implant-component', 'accessory', true],
  '模型配件':              ['clinical-tools', 'model-accessory', 'accessory'],
  '樹脂材料':              ['removable-prosthetics', 'resin-material', 'material'],
  '比色板':                ['color-characterization', 'shade-guide', 'durable_tool'],
  '氧化鋯塊':              ['digital-manufacturing', 'zirconia-blank', 'material'],
  '清潔 / 吸塵':           ['lab-equipment', 'cleaning-dust-control', 'equipment', true],
  '煮模 / 壓模工具':       ['lab-production', 'flasking-pressing-tool', 'durable_tool', true],
  '燒結爐':                ['digital-manufacturing', 'sintering-furnace', 'equipment'],
  '爐具配件':              ['lab-equipment', 'furnace-accessory', 'accessory'],
  '牙科器材':              ['clinical-tools', 'dental-instrument', 'durable_tool', true],
  '玻璃陶瓷':              ['digital-manufacturing', 'glass-ceramic', 'material'],
  '瓷爐':                  ['lab-equipment', 'ceramic-furnace', 'equipment'],
  '瓷筆 / 刷具':           ['color-characterization', 'ceramic-brush', 'durable_tool'],
  '瓷粉':                  ['fixed-restorative', 'ceramic-powder', 'material', true],
  '瓷粉 / 陶瓷':           ['fixed-restorative', 'ceramic-material', 'material'],
  '研磨砂 / 拋光砂':       ['lab-production', 'abrasive-media', 'consumable'],
  '磨石 / 研磨工具':       ['lab-production', 'grinding-tool', 'consumable'],
  '蠟 / 壓鑄材':           ['lab-production', 'wax-pressing-material', 'material'],
  '蠟塊':                  ['digital-manufacturing', 'wax-blank', 'material'],
  '蠟工設備':              ['lab-equipment', 'wax-equipment', 'equipment'],
  '設備':                  ['other-review', 'generic-equipment', 'equipment', true],
  '設備配件':              ['lab-equipment', 'equipment-accessory', 'accessory', true],
  '設計軟體':              ['software-digital-service', 'design-software', 'software_license'],
  '車機 / 研磨機':         ['digital-manufacturing', 'milling-machine', 'equipment'],
  '車機配件':              ['digital-manufacturing', 'milling-accessory', 'accessory'],
  '車針 / 鑽針':           ['lab-production', 'bur-drill', 'consumable'],
  '過濾耗材':              ['lab-production', 'filter-consumable', 'consumable'],
  '釉材':                  ['color-characterization', 'glaze-material', 'material'],
  '金屬材料':              ['fixed-restorative', 'metal-material', 'material'],
  '馬達 / 手機':           ['lab-equipment', 'motor-handpiece', 'equipment'],
  '馬達配件':              ['lab-equipment', 'motor-accessory', 'accessory'],
}

const BUSINESS_LABELS = {
  'digital-manufacturing': 'CAD/CAM 數位製造',
  'additive-manufacturing': '3D 列印',
  'fixed-restorative': '固定式修復材料',
  'removable-prosthetics': '活動義齒與人工牙',
  'color-characterization': '比色、染色與表面處理',
  'lab-production': '技工製程與耗材',
  'lab-equipment': '技工設備與基礎設施',
  'clinical-tools': '臨床／技工器械與輔助工具',
  'software-digital-service': '軟體與數位服務',
  'technical-service': '技術服務',
  'other-review': '待人工確認',
}

const REVIEW_CATEGORIES = new Set(
  Object.entries(CATEGORY_MAPPING).filter(([, value]) => value[3]).map(([key]) => key)
)

const resinPattern = /freep(?:rint)?|medicalprint|detax\s*shell|luxaprint|denture\s*(?:impact|flex)|(?:printing|print)\s*resin|castable\s*resin|樹脂料/i
const asigaResinPattern = /plas(?:gray|pink|clear|white)|fusiongray|dentamodel|denta\s*(?:base|tooth|gum|try|guide|cast|form|study|tray)|\b1kg\b.*bottle/i
const trayPlatformPattern = /build\s*trar?y|build\s*platform|成型台|成型平台|料槽/i
const sparePartPattern = /燈管|lamp|cable|board|馬達|motor|觸控面板|front\s*panel|projector|encoder|sensor|偵測器|油壓桿|cpu/i
const processConsumablePattern = /離型膜|film|filter|濾芯|清洗液|cleaning\s*(?:liquid|solution)|alcohol|手套|glove/i
const servicePattern = /software\s*service|service\s*(?:contract|plan)|服務費|維護合約|保養合約/i

// Official-source SKU allowlists. These intentionally use exact product codes:
// a brand-wide rule would turn repair parts, trays and machines into the same type.
const ASIGA_PRINTER_CODES = new Set(`
  AG-02391 AG-04634 AG-07323 AG-07388 AG-07915 AG-07930
`.trim().split(/\s+/))
const ASIGA_POST_PROCESSING_CODES = new Set(`
  AG-00194 AG-07946
`.trim().split(/\s+/))
const ASIGA_RESIN_CODES = new Set(`
  AG-00928 AG-00929 AG-00930 AG-00931 AG-01329 AG-03000 AG-03569 AG-03624 AG-03625 AG-03626
  AG-03653 AG-03768 AG-03810 AG-03817 AG-04504 AG-04748 AG-05167 AG-05367 AG-07862 AG-07876
`.trim().split(/\s+/))
const ASIGA_PRINTING_CONSUMABLE_CODES = new Set(`
  AG-0044 AG-02499 AG-02500 AG-02501 AG-02502 AG-04569 AG-04570 AG-04571 AG-05220 AG-05864
  AG-05868 AG-07419 AG-07422 AG-07647 AG-07650 AG-07741 AG-07788 AG-07789 AG-07950 AG-07957
`.trim().split(/\s+/))
const ASIGA_ACCESSORY_CODES = new Set(`
  AG-0077 AG-02479 AG-04248 AG-05226 AG-05359 AG-05565 AG-07063 AG-07440 AG-07570 AG-07951 AG-07956
`.trim().split(/\s+/))
const ASIGA_SPARE_PART_CODES = new Set(`
  AG-00194-1 AG-01407 AG-02551 AG-05899 AG-07035 AG-07391 AG-07446 AG-07458 AG-07514 AG-08110
  AG-08111 AG-08114
`.trim().split(/\s+/))
const DETAX_PRINT_RESIN_CODES = new Set(`
  DT-02040 DT-02076 DT-02099 DT-02128 DT-02177 DT-02332 DT-02376 DT-02378 DT-02415 DT-02417
  DT-02446 DT-02505 DT-02632 DT-02843 DT-02845 DT-02850 DT-02884 DT-03 DT-03016 DT-03105
  DT-03608 DT-03989 DT-04016 DT-04062 DT-04063 DT-04064 DT-04092 DT-04101 DT-04249 DT-04427
  DT-04432 DT-04433 DT-04436 DT-04625 DT-04626 DT-09900-2
`.trim().split(/\s+/))

const ASIGA_OFFICIAL_GROUPS = [
  ASIGA_PRINTER_CODES,
  ASIGA_POST_PROCESSING_CODES,
  ASIGA_RESIN_CODES,
  ASIGA_PRINTING_CONSUMABLE_CODES,
  ASIGA_ACCESSORY_CODES,
  ASIGA_SPARE_PART_CODES,
]
const OFFICIAL_3D_CODES = new Set([
  ...ASIGA_OFFICIAL_GROUPS.flatMap((group) => [...group]),
  ...DETAX_PRINT_RESIN_CODES,
])
const VERIFIED_PRODUCT_OVERRIDES = new Map([
  ['DK-DH-4', ['additive-manufacturing', 'print-resin', 'material']],
  ['GC-008408', ['color-characterization', 'glaze-material', 'material']],
  ['ME-001', ['additive-manufacturing', 'post-processing', 'equipment']],
  ['ME-001-1', ['additive-manufacturing', 'post-processing', 'spare_part']],
  ['ME-001-2', ['additive-manufacturing', 'post-processing', 'spare_part']],
  ['ME-001-3', ['additive-manufacturing', 'post-processing', 'spare_part']],
  ['ME-002', ['additive-manufacturing', 'post-processing', 'equipment']],
  ['ME-003', ['additive-manufacturing', 'print-resin', 'material']],
  ['ME-004', ['additive-manufacturing', 'print-resin', 'material']],
  ['ME-005', ['additive-manufacturing', 'post-processing', 'equipment']],
  ['PM-02', ['clinical-tools', 'implant-surface-treatment-equipment', 'equipment']],
  ['SY-01050-3', ['lab-equipment', 'light-curing-equipment', 'spare_part']],
  ['SY-01051', ['lab-equipment', 'light-curing-equipment', 'equipment']],
  ['SY-04170', ['lab-production', 'die-model-accessory', 'accessory']],
])

function countBy(items, selector) {
  const counts = new Map()
  for (const item of items) {
    const key = selector(item) || '<empty>'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function buildSeriesIndex(families) {
  const index = new Map()
  const add = (skuCode, family) => {
    if (typeof skuCode !== 'string' || !skuCode.trim()) return
    const code = skuCode.trim()
    const existing = index.get(code) || new Map()
    existing.set(family.id, {
      seriesId: family.id,
      seriesCode: family.seriesCode || null,
      seriesName: family.seriesName || null,
    })
    index.set(code, existing)
  }

  for (const family of families) {
    for (const skuCode of Object.values(family.skuMap || {})) add(skuCode, family)
    for (const skuCode of family.coveredSkuCodes || []) add(skuCode, family)
  }
  return index
}

function exactSeriesMatch(skuCode, index) {
  const matches = [...(index.get(skuCode)?.values() || [])]
  if (matches.length === 1) {
    return { status: 'exact_unique', seriesId: matches[0].seriesId, candidates: matches }
  }
  if (matches.length > 1) {
    return { status: 'exact_conflict', seriesId: null, candidates: matches }
  }
  return { status: 'unmatched', seriesId: null, candidates: [] }
}

function classify3d(product) {
  const name = product.name || ''
  const brand = product.brand || ''
  const code = product.code || ''

  if (VERIFIED_PRODUCT_OVERRIDES.has(code)) return VERIFIED_PRODUCT_OVERRIDES.get(code)

  if (ASIGA_PRINTER_CODES.has(code)) return ['additive-manufacturing', '3d-printer', 'equipment']
  if (ASIGA_POST_PROCESSING_CODES.has(code)) return ['additive-manufacturing', 'post-processing', 'equipment']
  if (ASIGA_RESIN_CODES.has(code) || DETAX_PRINT_RESIN_CODES.has(code)) {
    return ['additive-manufacturing', 'print-resin', 'material']
  }
  if (ASIGA_PRINTING_CONSUMABLE_CODES.has(code)) {
    return ['additive-manufacturing', 'printing-consumable', 'consumable']
  }
  if (ASIGA_ACCESSORY_CODES.has(code)) return ['additive-manufacturing', 'printer-accessory', 'accessory']
  if (ASIGA_SPARE_PART_CODES.has(code)) return ['additive-manufacturing', 'printer-spare-part', 'spare_part']
  if (brand === 'ASIGA') throw new Error(`ASIGA SKU lacks an official classification rule: ${code}`)

  const is3dContext = ['3D列印機', '3D列印機配件'].includes(product.category)
    || /3d\s*(?:printer|print|列印)|printing\s*resin|print\s*resin/i.test(name)

  if (!is3dContext) return null
  if (servicePattern.test(name)) return ['additive-manufacturing', 'printing-software-service', 'service']
  if (resinPattern.test(name) || (brand === 'ASIGA' && (product.category === '樹脂材料' || asigaResinPattern.test(name)))) {
    return ['additive-manufacturing', 'print-resin', 'material']
  }
  if (processConsumablePattern.test(name) || /build\s*trar?y|料槽/i.test(name)) {
    return ['additive-manufacturing', 'printing-consumable', 'consumable']
  }
  if (sparePartPattern.test(name)) return ['additive-manufacturing', 'printer-spare-part', 'spare_part']
  if (trayPlatformPattern.test(name)) return ['additive-manufacturing', 'printer-accessory', 'accessory']
  if (product.category === '光固化機' || /cure|固化|wash|洗淨/i.test(name)) {
    return ['additive-manufacturing', 'post-processing', 'equipment']
  }
  if (product.category === '3D列印機配件') return ['additive-manufacturing', 'printer-accessory', 'accessory']
  if (product.category === '3D列印機') return ['additive-manufacturing', '3d-printer', 'equipment']
  return null
}

function classifyProduct(product, seriesIndex) {
  const baseline = CATEGORY_MAPPING[product.category]
  if (!baseline) throw new Error(`Unknown legacy category: ${product.category}`)

  const override = classify3d(product)
  const [businessCategory, functionCategory, productKind] = override || baseline
  const seriesMatch = exactSeriesMatch(product.code, seriesIndex)
  const reviewReasons = []

  if (REVIEW_CATEGORIES.has(product.category) && !override) reviewReasons.push('ambiguous_legacy_category')
  if (!product.brand?.trim()) reviewReasons.push('missing_brand')
  if (seriesMatch.status === 'exact_conflict') reviewReasons.push('series_conflict')
  if (product.productType === '設備' && product.mainCategory !== '設備' && !override) {
    reviewReasons.push('equipment_axis_conflict')
  }
  if (product.mainCategory === '設備' && product.productType !== '設備' && !override) {
    reviewReasons.push('equipment_axis_conflict')
  }

  return {
    skuCode: product.code,
    taxonomy: {
      businessCategory,
      functionCategory,
      seriesId: seriesMatch.seriesId,
    },
    facets: {
      brand: product.brand || null,
      productKind,
    },
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    classificationStatus: businessCategory === 'other-review'
      ? 'unresolved'
      : reviewReasons.length > 0 ? 'needs_review' : 'approved_rule',
    classificationMethod: OFFICIAL_3D_CODES.has(product.code)
      ? 'official_sku_rule'
      : VERIFIED_PRODUCT_OVERRIDES.has(product.code) ? 'verified_sku_rule'
        : override ? 'specific_3d_rule' : 'legacy_category_rule',
    seriesMatch,
    legacy: {
      productType: product.productType,
      mainCategory: product.mainCategory,
      category: product.category,
    },
  }
}

function dictionaryOutput(generatorSourceHash) {
  const functions = {}
  for (const [legacyCategory, [businessCategory, functionCategory, productKind, reviewRequired = false]] of Object.entries(CATEGORY_MAPPING)) {
    functions[functionCategory] ||= {
      id: functionCategory,
      businessCategory,
      legacyCategories: [],
      defaultProductKind: productKind,
    }
    functions[functionCategory].legacyCategories.push(legacyCategory)
    if (reviewRequired) functions[functionCategory].reviewRequired = true
  }

  for (const [id, businessCategory, productKind] of [
    ['3d-printer', 'additive-manufacturing', 'equipment'],
    ['print-resin', 'additive-manufacturing', 'material'],
    ['post-processing', 'additive-manufacturing', 'equipment'],
    ['printer-accessory', 'additive-manufacturing', 'accessory'],
    ['printing-consumable', 'additive-manufacturing', 'consumable'],
    ['printer-spare-part', 'additive-manufacturing', 'spare_part'],
    ['printing-software-service', 'additive-manufacturing', 'software_license'],
    ['implant-surface-treatment-equipment', 'clinical-tools', 'equipment'],
    ['die-model-accessory', 'lab-production', 'accessory'],
  ]) {
    functions[id] ||= { id, businessCategory, legacyCategories: [], defaultProductKind: productKind }
  }

  return {
    schemaVersion: VERSION,
    generatorSourceHash,
    hierarchy: ['businessCategory', 'functionCategory', 'seriesId', 'skuCode'],
    facets: ['brand', 'productKind'],
    productKinds: PRODUCT_KINDS,
    businessCategories: Object.entries(BUSINESS_LABELS).map(([id, label]) => ({ id, label })),
    functionCategories: Object.values(functions).sort((a, b) => a.id.localeCompare(b.id)),
    legacyCategoryMapping: Object.fromEntries(
      Object.entries(CATEGORY_MAPPING).map(([category, value]) => [category, {
        businessCategory: value[0],
        functionCategory: value[1],
        productKind: value[2],
        reviewRequired: Boolean(value[3]),
      }])
    ),
    seriesPolicy: {
      acceptedSources: ['product_families.skuMap values', 'product_families.coveredSkuCodes'],
      matching: 'exact SKU only',
      prefixMatching: false,
      conflictBehavior: 'seriesId=null; reviewRequired=true; preserve all candidates',
    },
    evidenceSources: {
      asigaMaxSpecification: 'https://www.asiga.com/downloads/printers/Asiga-MAX-usen-web.pdf',
      asigaBuildTrayLifecycle: 'https://support.asiga.com/maintaining-the-build-tray-max/',
      asigaMaxProductBreakdown: 'https://support.asiga.com/product-breakdown-max/',
      detaxFreeprintModel: 'https://www.detax.de/de-wAssets/docs/dental/IFU-dental/IFU_3D-Kunststoffe/IFU_Freeprint_dental_model-2.0.pdf',
      detaxMedicalprintShell: 'https://www.detax.de/en/shop/produkte/medicalprint-shell.php',
      denkenDhPrintTray: 'https://denken-highdental.co.jp/3d/dh-print-tray/',
      gcOptiglazeColor: 'https://www.gc.dental/america/products/laboratory/indirect-composites/optiglaze-color',
      medifiveProductOverview: 'https://medifive.gobizkorea.com/mini/site/miniSiteMain.do',
      songYoungDieLockTray: 'https://songyoung.com.tw/product_detail.php?productID=230',
      actilinkRebornProductSheet: 'https://kyushu-dentalshow.jp/2026/wp-content/uploads/2025/04/ACTILINK-Reborn_202502_Nxt.pdf',
    },
  }
}

function summaryOutput(catalog, records, unknownCategories, generatedAt) {
  return {
    generatedAt,
    total: catalog.length,
    unknownCategory: unknownCategories.length,
    businessCategory: countBy(records, (item) => item.taxonomy.businessCategory),
    functionCategory: countBy(records, (item) => item.taxonomy.functionCategory),
    productKind: countBy(records, (item) => item.facets.productKind),
    classificationStatus: countBy(records, (item) => item.classificationStatus),
    classificationMethod: countBy(records, (item) => item.classificationMethod),
    review: countBy(records, (item) => item.reviewRequired ? 'required' : 'not_required'),
    seriesMatch: countBy(records, (item) => item.seriesMatch.status),
  }
}

function assertRequired3dRules(catalog, records) {
  const byCode = new Map(records.map((item) => [item.skuCode, item]))
  const checks = [
    {
      label: 'DETAX official print resin SKUs',
      products: catalog.filter((item) => DETAX_PRINT_RESIN_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'print-resin' && item.facets.productKind === 'material',
    },
    {
      label: 'ASIGA official printer SKUs',
      products: catalog.filter((item) => ASIGA_PRINTER_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === '3d-printer' && item.facets.productKind === 'equipment',
    },
    {
      label: 'ASIGA official post-processing SKUs',
      products: catalog.filter((item) => ASIGA_POST_PROCESSING_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'post-processing' && item.facets.productKind === 'equipment',
    },
    {
      label: 'ASIGA official resin SKUs',
      products: catalog.filter((item) => ASIGA_RESIN_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'print-resin' && item.facets.productKind === 'material',
    },
    {
      label: 'ASIGA finite-life build trays',
      products: catalog.filter((item) => ASIGA_PRINTING_CONSUMABLE_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'printing-consumable' && item.facets.productKind === 'consumable',
    },
    {
      label: 'ASIGA reusable accessories',
      products: catalog.filter((item) => ASIGA_ACCESSORY_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'printer-accessory' && item.facets.productKind === 'accessory',
    },
    {
      label: 'ASIGA repair parts',
      products: catalog.filter((item) => ASIGA_SPARE_PART_CODES.has(item.code)),
      expected: (item) => item.taxonomy.functionCategory === 'printer-spare-part' && item.facets.productKind === 'spare_part',
    },
  ]

  const asigaSourceCodes = new Set(catalog.filter((item) => item.brand === 'ASIGA').map((item) => item.code))
  const asigaRuleCodes = new Set(ASIGA_OFFICIAL_GROUPS.flatMap((group) => [...group]))
  const missingAsigaRules = [...asigaSourceCodes].filter((code) => !asigaRuleCodes.has(code))
  const missingAsigaProducts = [...asigaRuleCodes].filter((code) => !asigaSourceCodes.has(code))
  if (missingAsigaRules.length > 0 || missingAsigaProducts.length > 0) {
    throw new Error(`ASIGA official rules are incomplete: unclassified=${missingAsigaRules.join('|') || 'none'}; absent=${missingAsigaProducts.join('|') || 'none'}`)
  }

  const missingDetaxProducts = [...DETAX_PRINT_RESIN_CODES].filter((code) => !byCode.has(code))
  if (missingDetaxProducts.length > 0) {
    throw new Error(`DETAX official resin SKUs are absent from catalog: ${missingDetaxProducts.join(', ')}`)
  }

  for (const check of checks) {
    if (check.products.length === 0) throw new Error(`Required 3D check has no source products: ${check.label}`)
    const failures = check.products
      .map((product) => byCode.get(product.code))
      .filter((item) => !item || !check.expected(item))
    if (failures.length > 0) {
      throw new Error(`Required 3D rule failed (${check.label}): ${failures.map((item) => item?.skuCode || '<missing>').join(', ')}`)
    }
  }
}

function markdownSummary(summary, samples) {
  const table = (values) => Object.entries(values).map(([key, count]) => `| ${key} | ${count} |`).join('\n')
  const sampleRows = samples.map((item) =>
    `| ${item.skuCode} | ${item.taxonomy.businessCategory} | ${item.taxonomy.functionCategory} | ${item.facets.productKind} | ${item.reviewRequired ? 'yes' : 'no'} | ${item.seriesMatch.status} |`
  ).join('\n')

  return `# Product taxonomy dry-run summary

- Generated: ${summary.generatedAt}
- Total: ${summary.total}
- Unknown legacy category: ${summary.unknownCategory}

## Business category

| Value | Count |
|---|---:|
${table(summary.businessCategory)}

## Function category

| Value | Count |
|---|---:|
${table(summary.functionCategory)}

## Product kind

| Value | Count |
|---|---:|
${table(summary.productKind)}

## Classification status

| Value | Count |
|---|---:|
${table(summary.classificationStatus)}

## Classification method

| Value | Count |
|---|---:|
${table(summary.classificationMethod)}

## Review

| Value | Count |
|---|---:|
${table(summary.review)}

## Series match

| Value | Count |
|---|---:|
${table(summary.seriesMatch)}

## First 20

| SKU | Business | Function | Product kind | Review | Series match |
|---|---|---|---|---|---|
${sampleRows}
`
}

async function main() {
  const [catalog, families, generatorSource] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8').then(JSON.parse),
    readFile(FAMILIES_PATH, 'utf8').then(JSON.parse),
    readFile(GENERATOR_PATH, 'utf8'),
  ])
  const generatorSourceHash = createHash('sha256').update(generatorSource).digest('hex')

  if (!Array.isArray(catalog) || !Array.isArray(families)) throw new Error('Expected both source files to contain arrays')

  const sourceCategories = [...new Set(catalog.map((item) => item.category))].sort()
  const unknownCategories = sourceCategories.filter((category) => !CATEGORY_MAPPING[category])
  const unusedMappings = Object.keys(CATEGORY_MAPPING).filter((category) => !sourceCategories.includes(category))
  if (unknownCategories.length > 0) throw new Error(`Unknown legacy categories: ${unknownCategories.join(', ')}`)
  if (unusedMappings.length > 0) throw new Error(`Unused category mappings: ${unusedMappings.join(', ')}`)

  const duplicateCodes = Object.entries(countBy(catalog, (item) => item.code)).filter(([, count]) => count > 1)
  if (duplicateCodes.length > 0) throw new Error(`Duplicate SKU codes: ${duplicateCodes.map(([code]) => code).join(', ')}`)

  const seriesIndex = buildSeriesIndex(families)
  const records = catalog.map((product) => classifyProduct(product, seriesIndex))
  assertRequired3dRules(catalog, records)
  const generatedAt = new Date().toISOString()
  const summary = summaryOutput(catalog, records, unknownCategories, generatedAt)
  const samples = records.slice(0, 20)

  console.log(`mode=${WRITE_MODE ? 'write' : 'dry-run'}`)
  console.log(`total=${summary.total}`)
  console.log(`unknownCategory=${summary.unknownCategory}`)
  console.log('businessCategory=', summary.businessCategory)
  console.log('functionCategory=', summary.functionCategory)
  console.log('productKind=', summary.productKind)
  console.log('classificationStatus=', summary.classificationStatus)
  console.log('classificationMethod=', summary.classificationMethod)
  console.log('review=', summary.review)
  console.log('seriesMatch=', summary.seriesMatch)
  console.log('first20=')
  console.table(samples.map((item) => ({
    skuCode: item.skuCode,
    businessCategory: item.taxonomy.businessCategory,
    functionCategory: item.taxonomy.functionCategory,
    productKind: item.facets.productKind,
    review: item.reviewRequired,
    seriesMatch: item.seriesMatch.status,
  })))

  if (!WRITE_MODE) return

  const dictionaryPath = resolve(ROOT, 'data/product_taxonomy_dictionary.json')
  const mapPath = resolve(ROOT, 'data/product_taxonomy_map.json')
  const csvPath = resolve(ROOT, 'tmp/product-taxonomy-dry-run.csv')
  const summaryPath = resolve(ROOT, 'tmp/product-taxonomy-dry-run-summary.md')
  await Promise.all([mkdir(dirname(dictionaryPath), { recursive: true }), mkdir(dirname(csvPath), { recursive: true })])

  const mapOutput = {
    schemaVersion: VERSION,
    generatorSourceHash,
    source: ['public/products_catalog.json', 'public/product_families.json'],
    total: records.length,
    items: records,
  }
  const { items: mapItems, ...mapHeader } = mapOutput
  const mapJson = `${JSON.stringify(mapHeader, null, 2).slice(0, -2)},\n  "items": [\n${mapItems
    .map((item) => `    ${JSON.stringify(item)}`)
    .join(',\n')}\n  ]\n}\n`
  const csvHeader = ['skuCode', 'name', 'brand', 'businessCategory', 'functionCategory', 'productKind', 'classificationStatus', 'classificationMethod', 'seriesId', 'seriesMatch', 'reviewRequired', 'reviewReasons', 'legacyProductType', 'legacyMainCategory', 'legacyCategory']
  const csvRows = catalog.map((product, index) => {
    const item = records[index]
    return [
      item.skuCode,
      product.name,
      product.brand,
      item.taxonomy.businessCategory,
      item.taxonomy.functionCategory,
      item.facets.productKind,
      item.classificationStatus,
      item.classificationMethod,
      item.taxonomy.seriesId,
      item.seriesMatch.status,
      item.reviewRequired,
      item.reviewReasons,
      item.legacy.productType,
      item.legacy.mainCategory,
      item.legacy.category,
    ].map(csvCell).join(',')
  })

  await Promise.all([
    writeFile(dictionaryPath, `${JSON.stringify(dictionaryOutput(generatorSourceHash), null, 2)}\n`),
    writeFile(mapPath, mapJson),
    writeFile(csvPath, `${csvHeader.join(',')}\n${csvRows.join('\n')}\n`),
    writeFile(summaryPath, markdownSummary(summary, samples)),
  ])

  console.log('wrote=data/product_taxonomy_dictionary.json')
  console.log('wrote=data/product_taxonomy_map.json')
  console.log('wrote=tmp/product-taxonomy-dry-run.csv')
  console.log('wrote=tmp/product-taxonomy-dry-run-summary.md')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
