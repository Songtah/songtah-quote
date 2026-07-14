#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATHS = {
  generator: resolve(ROOT, 'scripts/build_product_taxonomy.mjs'),
  catalog: resolve(ROOT, 'public/products_catalog.json'),
  families: resolve(ROOT, 'public/product_families.json'),
  dictionary: resolve(ROOT, 'data/product_taxonomy_dictionary.json'),
  mapping: resolve(ROOT, 'data/product_taxonomy_map.json'),
}

const EXPECTED = {
  catalogRawHash: 'f8131d80b4df6d9ee2d2f7505a476a421997024cfbc20857edfe91f9a4770463',
  familiesRawHash: 'ab73a40d73bc77ec87b7a305c445e95e8216e8b336a15467b93965dda89fa376',
  catalogBusinessHash: 'bfbbaed426269528850294b9f557607ca6dd3cb6e8f9f40923c03369d579d8d8',
  familyIdsHash: '33f809e5b41c43f61338bb173220c9351c93e247c6009cac438ed881d1010d96',
  dictionaryContractHash: '096f9e06a12d356698fca61220bf128973f15c50e2d4a6d6c79844d6872fc87f',
  schemaVersion: '2026-07-14.v1',
  catalogRows: 6084,
  pricedRows: 2759,
  discontinuedRows: 140,
  stoppedRows: 91,
  notSoldRows: 49,
  familyRows: 42,
}
const EXPECTED_BUSINESS_IDS = [
  'digital-manufacturing', 'additive-manufacturing', 'fixed-restorative', 'removable-prosthetics',
  'color-characterization', 'lab-production', 'lab-equipment', 'clinical-tools',
  'software-digital-service', 'technical-service', 'other-review',
]
const EXPECTED_PRODUCT_KINDS = [
  'equipment', 'material', 'consumable', 'durable_tool', 'accessory', 'spare_part',
  'software_license', 'service', 'other_review',
]
const CLASSIFICATION_STATUSES = new Set(['approved_rule', 'needs_review', 'unresolved'])
const CLASSIFICATION_METHODS = new Set(['legacy_category_rule', 'official_sku_rule', 'verified_sku_rule', 'specific_3d_rule'])
const SUN_GRINDING_CODES = new Set(`
  SUN-PSC132104F SUN-PSC138104F SUN-PSC151104F SUN-PSC153104F SUN-PSC159104F SUN-PSC191104F
  SUN-PSC199104F SUN-PSC219104F SUN-PSC239104F SUN-PSC508104F SUN-PSC538104F SUN-PSC566104F
  SUN-PSC569104F SUN-PSCSET104/01 SUN-PSCSET104/05
`.trim().split(/\s+/))
const SUN_POLISHING_CODES = new Set(`
  SUN-PGS106104M SUN-PGS146104M SUN-PGS546104M SUN-PGS600104M SUN-PGSSET104/01
  SUN-TCP100104MSW4Z SUN-TCP100104XFSW4Z SUN-TCP140104C SUN-TCP140104M SUN-TCP140104XC
  SUN-TCP140104XF SUN-TCP158104MSW4Z SUN-TCP158104XFSW4Z SUN-TCP417104GR16 SUN-TCP419104GR16
  SUN-TCP541104MSW4Z SUN-TCP541104XCSW4Z SUN-TCP541104XFSW4Z SUN-TCP545104MSW4Z
  SUN-TCP545104XFSW4Z SUN-TCP546104M SUN-TCP546104XF SUN-TCPPASTE01/20 SUN-TCPSET104/01
  SUN-TCPSET104/02 SUN-TCPSET104/10 SUN-TCPSET104/11 SUN-XPL111104M SUN-XPL111104XF
  SUN-XPL547104M SUN-XPL548104C SUN-XPL548104M SUN-XPL628 SUN-XPL932 SUN-XPLPaste02/40
  SUN-XPLSET104/01
`.trim().split(/\s+/))
const SUN_REVIEW_CODES = new Set(['SUN-PSCSET104/05'])

const failures = []
const fail = (rule, skuCode, detail) => failures.push({ rule, skuCode: skuCode || '-', detail })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function duplicates(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value)
}

function assertCount(rule, actual, expected) {
  if (actual !== expected) fail(rule, '-', `expected=${expected}; actual=${actual}`)
}

function canonicalCatalogHash(catalog) {
  const rows = catalog
    .map((item) => ({
      code: item.code,
      discontinued: item.discontinued ?? null,
      name: item.name,
      price: item.price ?? null,
      status: item.status ?? null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
  return sha256(`${JSON.stringify(rows)}\n`)
}

function familyIdsHash(families) {
  const ids = families.map((family) => family.id).sort()
  return sha256(`${JSON.stringify(ids)}\n`)
}

function dictionaryContractHash(dictionary) {
  const contract = {
    businessCategories: [...dictionary.businessCategories].sort((a, b) => a.id.localeCompare(b.id)),
    productKinds: [...dictionary.productKinds].sort(),
    functionCategories: dictionary.functionCategories
      .map((item) => ({
        id: item.id,
        businessCategory: item.businessCategory,
        defaultProductKind: item.defaultProductKind,
        legacyCategories: [...item.legacyCategories].sort(),
        reviewRequired: Boolean(item.reviewRequired),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    legacyCategoryMapping: Object.entries(dictionary.legacyCategoryMapping).sort(([a], [b]) => a.localeCompare(b)),
  }
  return sha256(`${JSON.stringify(contract)}\n`)
}

function explicitSeriesIndex(families) {
  const index = new Map()
  const add = (skuCode, familyId) => {
    if (typeof skuCode !== 'string' || !skuCode.trim()) return
    const ids = index.get(skuCode) || new Set()
    ids.add(familyId)
    index.set(skuCode, ids)
  }
  for (const family of families) {
    for (const skuCode of Object.values(family.skuMap || {})) add(skuCode, family.id)
    for (const skuCode of family.coveredSkuCodes || []) add(skuCode, family.id)
  }
  return index
}

function assertDictionary(dictionary) {
  const namespaces = {
    businessCategories: dictionary.businessCategories?.map((item) => item.id) || [],
    functionCategories: dictionary.functionCategories?.map((item) => item.id) || [],
    productKinds: dictionary.productKinds || [],
  }
  for (const [name, ids] of Object.entries(namespaces)) {
    if (ids.length === 0) fail('dictionary_nonempty', name, 'namespace is empty')
    for (const id of duplicates(ids)) fail('dictionary_unique_id', id, `duplicate in ${name}`)
    for (const id of ids.filter((value) => typeof value !== 'string' || !value.trim())) {
      fail('dictionary_nonempty_id', String(id), `invalid id in ${name}`)
    }
  }
  const actualBusinessIds = [...namespaces.businessCategories].sort()
  const actualKinds = [...namespaces.productKinds].sort()
  if (JSON.stringify(actualBusinessIds) !== JSON.stringify([...EXPECTED_BUSINESS_IDS].sort())) {
    fail('business_contract', '-', `actual=${actualBusinessIds.join('|')}`)
  }
  if (JSON.stringify(actualKinds) !== JSON.stringify([...EXPECTED_PRODUCT_KINDS].sort())) {
    fail('product_kind_contract', '-', `actual=${actualKinds.join('|')}`)
  }
  return Object.fromEntries(Object.entries(namespaces).map(([name, ids]) => [name, new Set(ids)]))
}

function assertClassificationSamples(byCode, catalogByCode) {
  const cases = [
    ['AG-02391', 'additive-manufacturing', '3d-printer', 'equipment'],
    ['DT-02040', 'additive-manufacturing', 'print-resin', 'material'],
    ['AG-00194', 'additive-manufacturing', 'post-processing', 'equipment'],
    ['AG-0077', 'additive-manufacturing', 'printer-accessory', 'accessory'],
    ['AG-00194-1', 'additive-manufacturing', 'printer-spare-part', 'spare_part'],
    ['AG-02499', 'additive-manufacturing', 'printing-consumable', 'consumable'],
    ['AG-02479', 'additive-manufacturing', 'printer-accessory', 'accessory'],
    ['DK-DH-4', 'additive-manufacturing', 'print-resin', 'material'],
    ['GC-008408', 'color-characterization', 'glaze-material', 'material'],
    ['DB-001', 'software-digital-service', 'design-software', 'software_license'],
    ['GEN-03', 'software-digital-service', 'design-software', 'software_license'],
    ['ME-001-1', 'additive-manufacturing', 'post-processing', 'spare_part'],
    ['PM-02', 'clinical-tools', 'implant-surface-treatment-equipment', 'equipment'],
    ['SY-01051', 'lab-equipment', 'light-curing-equipment', 'equipment'],
    ['SY-04170', 'lab-production', 'die-model-accessory', 'accessory'],
    ['SUN-PSC138104F', 'lab-production', 'grinding-tool', 'consumable'],
    ['SUN-TCP140104M', 'lab-production', 'polishing-consumable', 'consumable'],
    ['SUN-PGS106104M', 'lab-production', 'polishing-consumable', 'consumable'],
    ['SUN-XPL548104C', 'lab-production', 'polishing-consumable', 'consumable'],
    ['SUN-XPLPaste02/40', 'lab-production', 'polishing-consumable', 'consumable'],
  ]
  for (const [skuCode, business, func, kind] of cases) {
    const item = byCode.get(skuCode)
    if (!item) {
      fail('classification_sample_exists', skuCode, 'mapping row missing')
      continue
    }
    const actual = [item.taxonomy?.businessCategory, item.taxonomy?.functionCategory, item.facets?.productKind]
    const expected = [business, func, kind]
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail('exact_classification_sample', skuCode, `expected=${expected.join('/')}; actual=${actual.join('/')}`)
    }
  }

  for (const [codes, func] of [[SUN_GRINDING_CODES, 'grinding-tool'], [SUN_POLISHING_CODES, 'polishing-consumable']]) {
    for (const skuCode of codes) {
      const item = byCode.get(skuCode)
      if (!item) {
        fail('sun_verified_sku_exists', skuCode, 'mapping row missing')
        continue
      }
      const actual = [item.taxonomy?.businessCategory, item.taxonomy?.functionCategory, item.facets?.productKind]
      const expected = ['lab-production', func, 'consumable']
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail('sun_verified_classification', skuCode, `expected=${expected.join('/')}; actual=${actual.join('/')}`)
      }
      if (item.classificationMethod !== 'verified_sku_rule') {
        fail('sun_verified_method', skuCode, String(item.classificationMethod))
      }
      const shouldReview = SUN_REVIEW_CODES.has(skuCode)
      if (item.reviewRequired !== shouldReview) {
        fail('sun_review_contract', skuCode, `expected=${shouldReview}; actual=${item.reviewRequired}`)
      }
      if (shouldReview && !item.reviewReasons?.includes('official_sku_code_mismatch')) {
        fail('sun_review_reason', skuCode, (item.reviewReasons || []).join('|'))
      }
      const source = catalogByCode.get(skuCode)
      const isKit = /\bkit\b/i.test(source?.name || '')
      if ((item.facets?.packageForm === 'kit') !== isKit) {
        fail('sun_kit_package_form', skuCode, `name=${source?.name || ''}; packageForm=${item.facets?.packageForm || '<empty>'}`)
      }
    }
  }
}

async function main() {
  const raw = Object.fromEntries(await Promise.all(Object.entries(PATHS).map(async ([key, path]) => [key, await readFile(path, 'utf8')])))
  const catalog = JSON.parse(raw.catalog)
  const families = JSON.parse(raw.families)
  const dictionary = JSON.parse(raw.dictionary)
  const mapping = JSON.parse(raw.mapping)
  const records = mapping.items

  if (!Array.isArray(catalog) || !Array.isArray(families) || !Array.isArray(records)) {
    throw new Error('catalog, families and mapping.items must be arrays')
  }
  const catalogByCode = new Map(catalog.map((item) => [item.code, item]))

  if (sha256(raw.catalog) !== EXPECTED.catalogRawHash) fail('catalog_raw_hash', '-', sha256(raw.catalog))
  if (sha256(raw.families) !== EXPECTED.familiesRawHash) fail('families_raw_hash', '-', sha256(raw.families))
  if (canonicalCatalogHash(catalog) !== EXPECTED.catalogBusinessHash) fail('catalog_business_hash', '-', canonicalCatalogHash(catalog))
  if (familyIdsHash(families) !== EXPECTED.familyIdsHash) fail('family_ids_hash', '-', familyIdsHash(families))
  if (dictionaryContractHash(dictionary) !== EXPECTED.dictionaryContractHash) {
    fail('dictionary_contract_hash', '-', dictionaryContractHash(dictionary))
  }
  const generatorSourceHash = sha256(raw.generator)
  if (dictionary.generatorSourceHash !== generatorSourceHash) {
    fail('dictionary_generator_hash', '-', `expected=${generatorSourceHash}; actual=${dictionary.generatorSourceHash}`)
  }
  if (mapping.generatorSourceHash !== generatorSourceHash) {
    fail('mapping_generator_hash', '-', `expected=${generatorSourceHash}; actual=${mapping.generatorSourceHash}`)
  }
  if (dictionary.schemaVersion !== EXPECTED.schemaVersion || mapping.schemaVersion !== EXPECTED.schemaVersion) {
    fail('schema_version', '-', `dictionary=${dictionary.schemaVersion}; mapping=${mapping.schemaVersion}`)
  }

  assertCount('catalog_rows', catalog.length, EXPECTED.catalogRows)
  assertCount('catalog_unique_codes', new Set(catalog.map((item) => item.code)).size, EXPECTED.catalogRows)
  assertCount('catalog_priced_rows', catalog.filter((item) => Object.hasOwn(item, 'price')).length, EXPECTED.pricedRows)
  assertCount('catalog_discontinued_rows', catalog.filter((item) => item.discontinued === true).length, EXPECTED.discontinuedRows)
  assertCount('catalog_stopped_rows', catalog.filter((item) => item.status === '已停售').length, EXPECTED.stoppedRows)
  assertCount('catalog_not_sold_rows', catalog.filter((item) => item.status === '未販售').length, EXPECTED.notSoldRows)
  assertCount('mestra_brand_rows', catalog.filter((item) => item.brand === 'MESTRA').length, 32)
  assertCount('legacy_dental_espan_rows', catalog.filter((item) => item.brand === 'DENTAL ESPAN').length, 0)
  assertCount('sun_brand_rows', catalog.filter((item) => item.brand === 'SUN Oberflächentechnik').length, 51)
  assertCount('family_rows', families.length, EXPECTED.familyRows)
  assertCount('family_unique_ids', new Set(families.map((family) => family.id)).size, EXPECTED.familyRows)
  assertCount('mapping_rows', records.length, catalog.length)
  assertCount('mapping_declared_total', mapping.total, records.length)

  const catalogCodes = new Set(catalog.map((item) => item.code))
  const mappingCodes = records.map((item) => item.skuCode)
  for (const skuCode of duplicates(mappingCodes)) fail('mapping_unique_sku', skuCode, 'duplicate mapping row')
  for (const skuCode of mappingCodes.filter((code) => !catalogCodes.has(code))) fail('mapping_extra_sku', skuCode, 'not present in catalog')
  const mappingCodeSet = new Set(mappingCodes)
  for (const skuCode of catalogCodes) if (!mappingCodeSet.has(skuCode)) fail('mapping_missing_sku', skuCode, 'catalog SKU has no mapping')

  const dictionaryIds = assertDictionary(dictionary)
  const functionParents = new Map(dictionary.functionCategories.map((item) => [item.id, item.businessCategory]))
  const seriesIndex = explicitSeriesIndex(families)
  const familyIds = new Set(families.map((family) => family.id))
  const byCode = new Map(records.map((item) => [item.skuCode, item]))

  for (const item of records) {
    const skuCode = item.skuCode
    const business = item.taxonomy?.businessCategory
    const func = item.taxonomy?.functionCategory
    const kind = item.facets?.productKind
    if (!dictionaryIds.businessCategories.has(business)) fail('business_dictionary_reference', skuCode, String(business))
    if (!dictionaryIds.functionCategories.has(func)) fail('function_dictionary_reference', skuCode, String(func))
    if (!dictionaryIds.productKinds.has(kind)) fail('product_kind_dictionary_reference', skuCode, String(kind))
    if (functionParents.get(func) !== business) {
      fail('function_business_parent', skuCode, `function=${func}; expected=${functionParents.get(func)}; actual=${business}`)
    }
    if (!CLASSIFICATION_STATUSES.has(item.classificationStatus)) {
      fail('classification_status_contract', skuCode, String(item.classificationStatus))
    }
    if (!CLASSIFICATION_METHODS.has(item.classificationMethod)) {
      fail('classification_method_contract', skuCode, String(item.classificationMethod))
    }
    if (item.reviewRequired !== (item.reviewReasons?.length > 0)) {
      fail('review_flag_reasons_consistency', skuCode, `review=${item.reviewRequired}; reasons=${item.reviewReasons?.length ?? 'missing'}`)
    }
    const expectedStatus = business === 'other-review'
      ? 'unresolved'
      : item.reviewRequired ? 'needs_review' : 'approved_rule'
    if (item.classificationStatus !== expectedStatus) {
      fail('review_status_consistency', skuCode, `expected=${expectedStatus}; actual=${item.classificationStatus}`)
    }
    if (item.classificationMethod === 'legacy_category_rule') {
      const expectedLegacy = dictionary.legacyCategoryMapping[item.legacy?.category]
      const actualLegacy = { businessCategory: business, functionCategory: func, productKind: kind }
      if (!expectedLegacy || expectedLegacy.businessCategory !== actualLegacy.businessCategory
        || expectedLegacy.functionCategory !== actualLegacy.functionCategory
        || expectedLegacy.productKind !== actualLegacy.productKind) {
        fail('legacy_rule_mapping', skuCode, `category=${item.legacy?.category}; actual=${business}/${func}/${kind}`)
      }
      if (expectedLegacy?.reviewRequired && !item.reviewRequired) {
        fail('legacy_minimum_review', skuCode, `category=${item.legacy?.category} requires review`)
      }
    }
    if (business === 'other-review' && (!item.reviewRequired || item.classificationStatus !== 'unresolved')) {
      fail('unresolved_requires_review', skuCode, `review=${item.reviewRequired}; status=${item.classificationStatus}`)
    }

    const explicitFamilies = [...(seriesIndex.get(skuCode) || [])]
    const expectedSeries = explicitFamilies.length === 1 ? explicitFamilies[0] : null
    if (item.taxonomy?.seriesId !== expectedSeries) {
      fail('series_exact_unique_only', skuCode, `expected=${expectedSeries}; actual=${item.taxonomy?.seriesId ?? null}; candidates=${explicitFamilies.join('|')}`)
    }
    if (item.taxonomy?.seriesId && !familyIds.has(item.taxonomy.seriesId)) {
      fail('series_existing_family', skuCode, item.taxonomy.seriesId)
    }
  }

  assertClassificationSamples(byCode, catalogByCode)

  const stats = {
    catalogRows: catalog.length,
    mappingRows: records.length,
    reviewRequired: records.filter((item) => item.reviewRequired).length,
    unresolved: records.filter((item) => item.classificationStatus === 'unresolved').length,
    officialSkuRules: records.filter((item) => item.classificationMethod === 'official_sku_rule').length,
    exactSeries: records.filter((item) => item.taxonomy?.seriesId).length,
    failures: failures.length,
  }
  console.log(JSON.stringify(stats, null, 2))

  if (failures.length > 0) {
    console.error('First 20 failures:')
    console.table(failures.slice(0, 20))
    process.exitCode = 1
  } else {
    console.log('product taxonomy validation: PASS')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
