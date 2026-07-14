#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = resolve(ROOT, 'public/products_catalog.json')
const FAMILIES_PATH = resolve(ROOT, 'public/product_families.json')
const TAXONOMY_MAP_PATH = resolve(ROOT, 'data/product_taxonomy_map.json')
const REPORT_JSON_PATH = resolve(ROOT, 'tmp/standalone-series-dry-run.json')
const REPORT_MD_PATH = resolve(ROOT, 'tmp/standalone-series-dry-run.md')
const WRITE_MODE = process.argv.includes('--write')
const SYNC_MAP_ONLY = process.argv.includes('--sync-map-only')

const GENERIC_BASES = new Set([
  '其他', '材料', '耗材', '配件', '零件', '工具', '設備', '商品', '產品',
  '服務', '維修', '加工', '運費', '套裝', '套裝組', '組合', '附件',
])

function explicitFamilySkuCodes(family) {
  return new Set([
    ...Object.values(family.skuMap ?? {}),
    ...(family.coveredSkuCodes ?? []),
  ].filter(Boolean))
}

function canonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const SUFFIX_PATTERN = new RegExp([
  String.raw`(?:\s*[（(][^()（）]{1,30}[)）])`,
  String.raw`(?:\s*[-_/]?\s*(?:No\.?\s*)?[A-Za-z]{0,4}\d+(?:[.xX×*\-/]\d+)*(?:\s*(?:mm|cm|m|ml|mL|cc|g|kg|μm|um|支|入|個|片|顆|包|組|盒|瓶|罐|條|枚|號|色|度|層|孔))?)`,
  String.raw`(?:\s+[-_/]?\s*(?:A[1-4](?:\.5)?|B[1-4]|C[1-4]|D[2-4]|BL[1-4]?|OM[1-3]|W[0-4]|L|M|S|XL|XXL))`,
].join('|'), 'iu')

const SEMANTIC_VARIANT = /(?:\b(?:kit|set|basic|advanced|anterior|posterior|dispersive|flex|upper|lower|left|right)\b|左|右|上顎|下顎|前齒|後齒|燈管|爐心|storage\s+case)/iu

function staticCharacterCount(value) {
  return canonicalText(value).replace(/[\s\p{P}\p{S}]/gu, '').length
}

function stemName(name) {
  let stem = canonicalText(name)
  const removed = []
  for (let index = 0; index < 4; index += 1) {
    const match = stem.match(new RegExp(`^(.*?)(?:${SUFFIX_PATTERN.source})$`, 'iu'))
    if (!match?.[1] || match[1].trim() === stem) break
    const rawTail = stem.slice(match[1].length).trim()
    if (/^[-_/,:#]*\s*\d+(?:\.\d+)?$/u.test(rawTail)) break
    const next = match[1].trim().replace(/[-_/,:]+$/u, '').trim()
    if (!next || staticCharacterCount(next) < 4) break
    removed.unshift(rawTail)
    stem = next
  }
  return { stem, removed: removed.join(' ') }
}

function commonSkuPrefix(codes) {
  if (codes.length === 0) return ''
  let prefix = canonicalText(codes[0]).toUpperCase()
  for (const code of codes.slice(1)) {
    const candidate = canonicalText(code).toUpperCase()
    while (prefix && !candidate.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}

function hasSkuCorroboration(items) {
  const prefix = commonSkuPrefix(items.map((item) => item.code))
  const compact = prefix.replace(/[^A-Z0-9]/g, '')
  return compact.length >= 3 && /[A-Z]/.test(compact)
}

function candidateRisk(group) {
  const names = new Set(group.items.map((item) => canonicalText(item.name).toLocaleLowerCase('zh-TW')))
  if (names.size === 1) return 'identicalName'
  if (group.items.some((item) => !item.removed)) return 'mixedUnsuffixed'
  if (staticCharacterCount(group.stem) < 4) return 'shortBase'
  if (group.items.some((item) => SEMANTIC_VARIANT.test(item.name))) return 'semanticVariant'
  if (group.items.some((item) => /車針|鑽針/u.test(item.category ?? ''))) return 'opaqueToolCode'

  const suffixText = group.items.map((item) => item.removed).join(' ')
  if (/(?:^|\s)(?:ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s|$)/iu.test(suffixText)) return 'versionOrGeneration'
  const scrubbed = suffixText
    .replace(/[()（）]/g, ' ')
    .replace(/(?:未販售|停售|停產)/gu, ' ')
    .replace(/(?:A[0-4](?:\.5)?|B[0-4]|C[0-4]|D[0-4]|OA[0-4](?:\.5)?|DA[0-4](?:\.5)?|DB[0-4]|DC[0-4]|DD[0-4]|OM[1-3]|BL[1-4]?|W[0-4])/giu, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:mm|cm|ml|mL|cc|g|kg|lb|μm|um|支|入|個|片|顆|包|組|盒|瓶|罐|條|枚|號|色|度|層|孔)/giu, ' ')
    .replace(/\d+(?:\.\d+)?(?:H|x|X|×|\*)\d+(?:\.\d+)?/gu, ' ')
    .replace(/\d+(?:\.\d+)?\s*[-/]\s*\d+(?:\.\d+)?/gu, ' ')
    .replace(/[\d\s,./_\-#]/g, '')
  if (scrubbed) return 'arbitraryCodeOrLabel'
  if (!hasSkuCorroboration(group.items)) return 'weakSkuStructure'
  return 'autoStandardSpec'
}

function stableId(groupKey) {
  return `NAME-${createHash('sha256').update(groupKey).digest('hex').slice(0, 12).toUpperCase()}`
}

async function syncExactFamilyMap(families) {
  const mapping = JSON.parse(await readFile(TAXONOMY_MAP_PATH, 'utf8'))
  const memberships = new Map()
  for (const family of families) {
    for (const skuCode of explicitFamilySkuCodes(family)) {
      const candidates = memberships.get(skuCode) ?? []
      if (!candidates.some((candidate) => candidate.id === family.id)) candidates.push(family)
      memberships.set(skuCode, candidates)
    }
  }

  let updatedRows = 0
  for (const item of mapping.items) {
    const candidates = memberships.get(item.skuCode) ?? []
    const exact = candidates.length === 1 ? candidates[0] : null
    const nextSeriesId = exact?.id ?? null
    if (item.taxonomy.seriesId !== nextSeriesId) updatedRows += 1
    item.taxonomy.seriesId = nextSeriesId
    item.seriesMatch = exact
      ? {
          status: 'exact_unique',
          seriesId: exact.id,
          candidates: [{ seriesId: exact.id, seriesCode: exact.seriesCode, seriesName: exact.seriesName }],
        }
      : {
          status: candidates.length > 1 ? 'explicit_conflict' : 'unmatched',
          seriesId: null,
          candidates: candidates.map((family) => ({
            seriesId: family.id,
            seriesCode: family.seriesCode,
            seriesName: family.seriesName,
          })),
        }
  }
  const { items, ...header } = mapping
  const serialized = `${JSON.stringify(header, null, 2).slice(0, -2)},\n  "items": [\n${items
    .map((item) => `    ${JSON.stringify(item)}`)
    .join(',\n')}\n  ]\n}\n`
  await writeFile(TAXONOMY_MAP_PATH, serialized)
  return updatedRows
}

function buildCandidateGroups(catalog, families) {
  const assignedCodes = new Set()
  for (const family of families) {
    for (const code of explicitFamilySkuCodes(family)) assignedCodes.add(code)
  }

  const standalone = catalog.filter((item) => !assignedCodes.has(item.code))
  const exclusionCounts = {
    needsReview: 0,
    missingFacet: 0,
    noMatchingPeer: 0,
    identicalName: 0,
    mixedUnsuffixed: 0,
    shortBase: 0,
    semanticVariant: 0,
    opaqueToolCode: 0,
    versionOrGeneration: 0,
    arbitraryCodeOrLabel: 0,
    weakSkuStructure: 0,
  }
  const buckets = new Map()

  for (const item of standalone) {
    if (item.needsReview) {
      exclusionCounts.needsReview += 1
      continue
    }
    const facets = [item.brand, item.mainCategoryId, item.categoryId, item.productType].map(canonicalText)
    if (facets.some((value) => !value)) {
      exclusionCounts.missingFacet += 1
      continue
    }
    const { stem, removed } = stemName(item.name)
    const key = [...facets.map((value) => value.toLocaleLowerCase('zh-TW')), stem.toLocaleLowerCase('zh-TW')].join('\u001f')
    const group = buckets.get(key) ?? { stem, items: [] }
    group.items.push({ ...item, removed })
    buckets.set(key, group)
  }

  const existingIds = new Set(families.map((family) => family.id))
  const existingNames = new Set(families.map((family) => canonicalText(family.seriesName).toLocaleLowerCase('zh-TW')))
  const groups = []

  for (const [groupKey, group] of buckets) {
    if (group.items.length < 2) {
      exclusionCounts.noMatchingPeer += group.items.length
      continue
    }
    const risk = candidateRisk(group)
    if (risk !== 'autoStandardSpec') {
      exclusionCounts[risk] += group.items.length
      continue
    }

    const normalizedBase = canonicalText(group.stem).replace(/\s*系列$/u, '').trim()
    if (GENERIC_BASES.has(normalizedBase.toLocaleLowerCase('zh-TW'))) continue

    const id = stableId(groupKey)
    const seriesName = /系列$/u.test(normalizedBase) ? normalizedBase : `${normalizedBase} 系列`
    if (existingIds.has(id) || existingNames.has(seriesName.toLocaleLowerCase('zh-TW'))) {
      exclusionCounts.arbitraryCodeOrLabel += group.items.length
      continue
    }

    const first = group.items[0]
    const sortedItems = [...group.items].sort((a, b) => a.code.localeCompare(b.code))
    const nameCounts = new Map()
    for (const item of sortedItems) {
      const name = canonicalText(item.name)
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
    }
    const optionByCode = new Map(sortedItems.map((item) => {
      const name = canonicalText(item.name)
      return [item.code, nameCounts.get(name) === 1 ? name : `${name}（${item.code}）`]
    }))
    const options = sortedItems.map((item) => optionByCode.get(item.code))
    const skuMap = Object.fromEntries(sortedItems.map((item) => [optionByCode.get(item.code), item.code]))
    groups.push({
      family: {
        id,
        seriesCode: id,
        seriesName,
        brand: first.brand,
        productType: first.productType,
        category: first.category,
        skuPattern: '',
        namePattern: '{規格}',
        specs: [{ key: '規格', label: '規格 / 型號', options }],
        skuMap,
      },
      confidence: 'high',
      reason: '同品牌與四層分類；只差可辨識規格尾碼；SKU 具共同結構',
      mainCategory: first.mainCategory,
      items: sortedItems
        .map((item) => ({
          code: item.code,
          name: item.name,
          removedSuffix: item.removed,
          price: item.price ?? null,
          status: item.status ?? (item.discontinued ? '停售或未販售' : '在售'),
          discontinued: Boolean(item.discontinued),
        }))
    })
  }

  groups.sort((a, b) =>
    a.family.brand.localeCompare(b.family.brand, 'zh-TW') ||
    a.family.seriesName.localeCompare(b.family.seriesName, 'zh-TW') ||
    a.family.id.localeCompare(b.family.id)
  )

  return { standalone, groups, exclusionCounts }
}

function markdownReport(report) {
  const lines = [
    '# 獨立單品名稱歸組 dry-run',
    '',
    `- 模式：${report.mode}`,
    `- 目前系列：${report.existingFamilyCount}`,
    `- 目前獨立單品：${report.standaloneCount}`,
    `- 高信心候選系列：${report.candidateFamilyCount}`,
    `- 可歸組 SKU：${report.candidateSkuCount}`,
    `- 寫入後系列總數：${report.resultingFamilyCount}`,
    `- 寫入後獨立單品：${report.resultingStandaloneCount}`,
    `- 目錄現有欄位：${report.catalogFields.join('、')}`,
    `- 系列現有欄位：${report.familyFields.join('、')}`,
    '',
    '## 排除統計',
    '',
    ...Object.entries(report.exclusionCounts).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## 前 20 組樣本',
    '',
  ]
  for (const [index, group] of report.first20.entries()) {
    lines.push(
      `### ${index + 1}. ${group.seriesName}`,
      '',
      `- ID：${group.id}`,
      `- 品牌／分類／型態：${group.brand}／${group.mainCategory} › ${group.category}／${group.productType}`,
      `- SKU 數：${group.items.length}`,
      ...group.items.slice(0, 20).map((item) => `- ${item.code}｜${item.name}${item.discontinued ? '｜停售或未販售' : ''}`),
      group.items.length > 20 ? `- ……另有 ${group.items.length - 20} 筆` : '',
      '',
    )
  }
  return `${lines.filter((line) => line !== undefined).join('\n')}\n`
}

async function main() {
  if (SYNC_MAP_ONLY) {
    const families = JSON.parse(await readFile(FAMILIES_PATH, 'utf8'))
    const updatedRows = await syncExactFamilyMap(families)
    console.log(JSON.stringify({ mode: 'sync-map-only', familyCount: families.length, updatedRows }, null, 2))
    return
  }
  const [catalogRaw, familiesRaw] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8'),
    readFile(FAMILIES_PATH, 'utf8'),
  ])
  const catalog = JSON.parse(catalogRaw)
  const families = JSON.parse(familiesRaw)
  const { standalone, groups, exclusionCounts } = buildCandidateGroups(catalog, families)
  const candidateSkuCount = groups.reduce((sum, group) => sum + group.items.length, 0)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: WRITE_MODE ? 'write' : 'dry-run',
    existingFamilyCount: families.length,
    standaloneCount: standalone.length,
    candidateFamilyCount: groups.length,
    candidateSkuCount,
    resultingFamilyCount: families.length + groups.length,
    resultingStandaloneCount: standalone.length - candidateSkuCount,
    catalogFields: [...new Set(catalog.flatMap((item) => Object.keys(item)))].sort(),
    familyFields: [...new Set(families.flatMap((family) => Object.keys(family)))].sort(),
    exclusionCounts,
    first20: groups.slice(0, 20).map((group) => ({
      id: group.family.id,
      seriesName: group.family.seriesName,
      brand: group.family.brand,
      mainCategory: group.mainCategory,
      category: group.family.category,
      productType: group.family.productType,
      confidence: group.confidence,
      reason: group.reason,
      items: group.items,
    })),
    groups: groups.map((group) => ({ ...group.family, mainCategory: group.mainCategory, confidence: group.confidence, reason: group.reason, items: group.items })),
  }

  await mkdir(resolve(ROOT, 'tmp'), { recursive: true })
  await Promise.all([
    writeFile(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(REPORT_MD_PATH, markdownReport(report)),
  ])

  if (WRITE_MODE && groups.length > 0) {
    const nextFamilies = [...families, ...groups.map((group) => group.family)]
    await writeFile(FAMILIES_PATH, `${JSON.stringify(nextFamilies, null, 2)}\n`)
    report.taxonomyMapUpdatedRows = await syncExactFamilyMap(nextFamilies)
  }

  console.log(JSON.stringify({
    mode: report.mode,
    existingFamilyCount: report.existingFamilyCount,
    standaloneCount: report.standaloneCount,
    candidateFamilyCount: report.candidateFamilyCount,
    candidateSkuCount: report.candidateSkuCount,
    resultingFamilyCount: report.resultingFamilyCount,
    resultingStandaloneCount: report.resultingStandaloneCount,
    exclusionCounts: report.exclusionCounts,
    reportJson: REPORT_JSON_PATH,
    reportMarkdown: REPORT_MD_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
