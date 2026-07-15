#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = resolve(ROOT, 'public/products_catalog.json')
const FAMILIES_PATH = resolve(ROOT, 'public/product_families.json')
const WRITE_MODE = process.argv.includes('--write')
const REPORT_JSON_PATH = resolve(ROOT, WRITE_MODE ? 'tmp/infix-series-write-report.json' : 'tmp/infix-series-dry-run.json')
const REPORT_MD_PATH = resolve(ROOT, WRITE_MODE ? 'tmp/infix-series-write-report.md' : 'tmp/infix-series-dry-run.md')

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function explicitCodes(family) {
  return [
    ...Object.values(family.skuMap ?? {}),
    ...(family.coveredSkuCodes ?? []),
    ...(family.manualAssignedSkuCodes ?? []),
  ].filter(Boolean)
}

function groupFacet(item) {
  const parts = normalize(item.code).split('-').filter(Boolean)
  if (parts.length < 3) return { reason: 'noInfix' }

  const prefix = parts[0].toUpperCase()
  const infix = parts[1].toUpperCase()
  if (!/^[A-Z0-9]{2,20}$/.test(infix) || !/[A-Z]/.test(infix)) return { reason: 'invalidInfix' }
  if (item.needsReview) return { reason: 'needsReview' }

  const brand = normalize(item.brand)
  const mainCategory = normalize(item.mainCategory)
  const category = normalize(item.category)
  const productType = normalize(item.productType)
  if (!brand || !mainCategory || !category || !productType) return { reason: 'missingFacet' }

  return {
    key: [brand, prefix, infix, category, productType].join('\u001f'),
    prefix,
    infix,
    brand,
    mainCategory,
    category,
    categoryId: normalize(item.categoryId),
    productType,
  }
}

async function loadManualAssignments() {
  const configured = Boolean(process.env.NOTION_TOKEN && process.env.NOTION_PRODUCTS_DB)
  if (!configured) return { configured: false, assignments: new Map() }

  const { Client } = await import('@notionhq/client')
  const notion = new Client({ auth: process.env.NOTION_TOKEN })
  const rows = []
  let cursor
  do {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_PRODUCTS_DB,
      filter: { property: '系列群組', rich_text: { is_not_empty: true } },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    rows.push(...response.results)
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)

  const readText = (page, field) => (page.properties?.[field]?.rich_text ?? [])
    .map((part) => part.plain_text ?? '')
    .join('')
  const assignments = new Map()
  for (const page of rows) {
    const skuCode = readText(page, '貨號')
    const familyId = readText(page, '系列群組')
    if (skuCode && familyId && !assignments.has(skuCode)) assignments.set(skuCode, familyId)
  }
  return { configured: true, assignments }
}

function uniqueOptionMap(items) {
  const counts = new Map()
  for (const item of items) {
    const name = normalize(item.name)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Object.fromEntries(items.map((item) => {
    const name = normalize(item.name)
    const option = counts.get(name) === 1 ? name : `${name}（${item.code}）`
    return [option, item.code]
  }))
}

function stableSuffix(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8).toUpperCase()
}

function markdownReport(report) {
  const lines = [
    '# 貨號中綴系列 dry-run',
    '',
    `- 模式：${report.mode}`,
    `- 產品總數：${report.catalogCount}`,
    `- 現有系列：${report.existingFamilyCount}`,
    `- 靜態系列已歸屬 SKU：${report.staticAssignedSkuCount}`,
    `- Notion 手動歸屬已載入：${report.notionAssignmentsLoaded ? '是' : '否'}`,
    `- Notion 手動歸屬 SKU：${report.notionManualAssignmentCount}`,
    `- 預計新增系列：${report.newFamilyCount}`,
    `- 預計補入既有系列：${report.extendedFamilyCount}`,
    `- 預計歸組 SKU：${report.candidateSkuCount}`,
    `- 衝突群組：${report.conflictGroupCount}`,
    `- 既有重複系列碼：${report.existingDuplicateSeriesCodes.length}`,
    '',
    '## 排除與候選統計',
    '',
    ...Object.entries(report.counts).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## 前 20 組實際變更',
    '',
  ]
  for (const [index, group] of report.first20.entries()) {
    lines.push(
      `### ${index + 1}. ${group.seriesName}`,
      '',
      `- 動作：${group.action === 'create' ? '新增系列' : `補入既有系列 ${group.targetFamilyId}`}`,
      `- 系列碼：${group.seriesCode}`,
      `- 品牌／分類／型態：${group.brand}／${group.mainCategory} › ${group.category}／${group.productType}`,
      `- SKU：${group.items.length}`,
      ...group.items.slice(0, 20).map((item) => `- ${item.code}｜${item.name}`),
      group.items.length > 20 ? `- ……另有 ${group.items.length - 20} 筆` : '',
      '',
    )
  }
  if (report.conflicts.length > 0) {
    lines.push('## 衝突群組（不寫入）', '')
    for (const conflict of report.conflicts.slice(0, 20)) {
      lines.push(
        `- ${conflict.infix} ${conflict.category}｜候選 ${conflict.candidateCount} 筆｜既有系列 ${conflict.ownerFamilyIds.join('、') || '無'}｜Notion 系列 ${conflict.manualFamilyIds.join('、') || '無'}`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const [catalogRaw, familiesRaw, manualResult] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8'),
    readFile(FAMILIES_PATH, 'utf8'),
    loadManualAssignments(),
  ])
  const catalog = JSON.parse(catalogRaw)
  const families = JSON.parse(familiesRaw)
  const manualAssignments = manualResult.assignments
  if (WRITE_MODE && !manualResult.configured) {
    throw new Error('寫入模式必須載入 Notion 手動系列歸屬，請先載入 .env.local')
  }

  const catalogByCode = new Map(catalog.map((item) => [item.code, item]))
  const staticOwners = new Map()
  for (const family of families) {
    for (const skuCode of explicitCodes(family)) {
      const owners = staticOwners.get(skuCode) ?? new Set()
      owners.add(family.id)
      staticOwners.set(skuCode, owners)
    }
  }
  const preexistingStaticConflictCount = [...staticOwners.values()].filter((owners) => owners.size > 1).length
  if (preexistingStaticConflictCount > 0) throw new Error(`現有靜態系列已有 ${preexistingStaticConflictCount} 筆 SKU 衝突，停止分群`)

  const buckets = new Map()
  const counts = {
    alreadyInStaticFamily: 0,
    manuallyAssignedInNotion: 0,
    noInfix: 0,
    invalidInfix: 0,
    needsReview: 0,
    missingFacet: 0,
    singletonNewGroup: 0,
    conflictCandidateSku: 0,
    createCandidateSku: 0,
    extendCandidateSku: 0,
  }

  for (const item of catalog) {
    const facet = groupFacet(item)
    if (!facet.key) {
      counts[facet.reason] += 1
      continue
    }
    const bucket = buckets.get(facet.key) ?? { ...facet, items: [] }
    bucket.items.push(item)
    buckets.set(facet.key, bucket)
  }

  const changes = []
  const conflicts = []
  for (const group of buckets.values()) {
    const candidateItems = group.items.filter((item) => {
      if (staticOwners.has(item.code)) {
        counts.alreadyInStaticFamily += 1
        return false
      }
      if (manualAssignments.has(item.code)) {
        counts.manuallyAssignedInNotion += 1
        return false
      }
      return true
    })
    if (candidateItems.length === 0) continue

    const ownerFamilyIds = new Set()
    const manualFamilyIds = new Set()
    for (const item of group.items) {
      for (const owner of staticOwners.get(item.code) ?? []) ownerFamilyIds.add(owner)
      const manualFamilyId = manualAssignments.get(item.code)
      if (manualFamilyId) manualFamilyIds.add(manualFamilyId)
    }
    const manualIsCompatible = manualFamilyIds.size === 0 || (
      ownerFamilyIds.size === 1 &&
      [...manualFamilyIds].every((familyId) => ownerFamilyIds.has(familyId))
    )
    if (ownerFamilyIds.size > 1 || !manualIsCompatible) {
      counts.conflictCandidateSku += candidateItems.length
      conflicts.push({
        ...group,
        candidateCount: candidateItems.length,
        ownerFamilyIds: [...ownerFamilyIds],
        manualFamilyIds: [...manualFamilyIds],
      })
      continue
    }

    const items = [...candidateItems].sort((a, b) => a.code.localeCompare(b.code))
    if (ownerFamilyIds.size === 1) {
      const targetFamilyId = [...ownerFamilyIds][0]
      const target = families.find((family) => family.id === targetFamilyId)
      if (!target) throw new Error(`找不到既有系列 ${targetFamilyId}`)
      counts.extendCandidateSku += items.length
      changes.push({
        action: 'extend',
        targetFamilyId,
        seriesCode: target.seriesCode,
        seriesName: target.seriesName,
        ...group,
        items,
      })
      continue
    }

    if (items.length < 2) {
      counts.singletonNewGroup += items.length
      continue
    }
    counts.createCandidateSku += items.length
    changes.push({
      action: 'create',
      targetFamilyId: null,
      seriesCode: `${group.prefix}-${group.infix}`,
      seriesName: `${group.infix} ${group.category}`,
      ...group,
      items,
    })
  }

  const createSeriesCodeCounts = new Map()
  for (const change of changes.filter((item) => item.action === 'create')) {
    createSeriesCodeCounts.set(change.seriesCode, (createSeriesCodeCounts.get(change.seriesCode) ?? 0) + 1)
  }
  const existingIds = new Set(families.map((family) => family.id))
  const existingSeriesCodes = new Set(families.map((family) => normalize(family.seriesCode).toUpperCase()))
  const existingSeriesCodeGroups = new Map()
  for (const family of families) {
    const code = normalize(family.seriesCode).toUpperCase()
    const group = existingSeriesCodeGroups.get(code) ?? []
    group.push({ id: family.id, seriesName: family.seriesName })
    existingSeriesCodeGroups.set(code, group)
  }
  const existingDuplicateSeriesCodes = [...existingSeriesCodeGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([seriesCode, group]) => ({ seriesCode, families: group }))
  for (const change of changes.filter((item) => item.action === 'create')) {
    const duplicateCode = createSeriesCodeCounts.get(change.seriesCode) > 1 || existingSeriesCodes.has(change.seriesCode)
    if (duplicateCode) {
      const categorySuffix = change.categoryId || stableSuffix(change.key)
      change.seriesCode = `${change.prefix}-${change.infix}-${categorySuffix}`.toUpperCase()
    }
    let id = change.seriesCode
    if (existingIds.has(id)) id = `INFIX-${stableSuffix(change.key)}`
    change.targetFamilyId = id
    existingIds.add(id)
    existingSeriesCodes.add(change.seriesCode)
  }

  changes.sort((a, b) => b.items.length - a.items.length || a.seriesCode.localeCompare(b.seriesCode))
  const candidateSkuCount = changes.reduce((total, change) => total + change.items.length, 0)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: WRITE_MODE ? 'write' : 'dry-run',
    catalogCount: catalog.length,
    catalogFields: [...new Set(catalog.flatMap((item) => Object.keys(item)))].sort(),
    existingFamilyCount: families.length,
    familyFields: [...new Set(families.flatMap((family) => Object.keys(family)))].sort(),
    staticAssignedSkuCount: staticOwners.size,
    notionAssignmentsLoaded: manualResult.configured,
    notionManualAssignmentCount: manualAssignments.size,
    newFamilyCount: changes.filter((item) => item.action === 'create').length,
    extendedFamilyCount: new Set(changes.filter((item) => item.action === 'extend').map((item) => item.targetFamilyId)).size,
    candidateSkuCount,
    conflictGroupCount: conflicts.length,
    existingDuplicateSeriesCodes,
    counts,
    first20: changes.slice(0, 20).map((change) => ({
      ...change,
      items: change.items.map((item) => ({ code: item.code, name: item.name })),
    })),
    changes: changes.map((change) => ({
      ...change,
      items: change.items.map((item) => ({ code: item.code, name: item.name })),
    })),
    conflicts: conflicts.map((conflict) => ({
      infix: conflict.infix,
      category: conflict.category,
      candidateCount: conflict.candidateCount,
      ownerFamilyIds: conflict.ownerFamilyIds,
      manualFamilyIds: conflict.manualFamilyIds,
    })),
  }

  await mkdir(resolve(ROOT, 'tmp'), { recursive: true })
  await Promise.all([
    writeFile(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(REPORT_MD_PATH, markdownReport(report)),
  ])

  if (WRITE_MODE) {
    const nextFamilies = families.map((family) => ({ ...family }))
    const nextById = new Map(nextFamilies.map((family) => [family.id, family]))
    for (const change of changes) {
      if (change.action === 'extend') {
        const target = nextById.get(change.targetFamilyId)
        target.coveredSkuCodes = Array.from(new Set([
          ...(target.coveredSkuCodes ?? []),
          ...change.items.map((item) => item.code),
        ])).sort()
        continue
      }
      const skuMap = uniqueOptionMap(change.items)
      const family = {
        id: change.targetFamilyId,
        seriesCode: change.seriesCode,
        seriesName: change.seriesName,
        brand: change.brand,
        productType: change.productType,
        category: change.category,
        skuPattern: '',
        namePattern: '{規格}',
        specs: [{ key: '規格', label: '規格 / 型號', options: Object.keys(skuMap) }],
        skuMap,
      }
      nextFamilies.push(family)
      nextById.set(family.id, family)
    }
    await writeFile(FAMILIES_PATH, `${JSON.stringify(nextFamilies, null, 2)}\n`)
  }

  console.log(JSON.stringify({
    mode: report.mode,
    catalogCount: report.catalogCount,
    existingFamilyCount: report.existingFamilyCount,
    staticAssignedSkuCount: report.staticAssignedSkuCount,
    notionAssignmentsLoaded: report.notionAssignmentsLoaded,
    notionManualAssignmentCount: report.notionManualAssignmentCount,
    newFamilyCount: report.newFamilyCount,
    extendedFamilyCount: report.extendedFamilyCount,
    candidateSkuCount: report.candidateSkuCount,
    conflictGroupCount: report.conflictGroupCount,
    counts: report.counts,
    reportJson: REPORT_JSON_PATH,
    reportMarkdown: REPORT_MD_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
