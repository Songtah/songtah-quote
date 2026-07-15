#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = resolve(ROOT, 'public/products_catalog.json')
const FAMILIES_PATH = resolve(ROOT, 'public/product_families.json')
const MAPPING_PATH = resolve(ROOT, 'data/product_taxonomy_map.json')
const WRITE_MODE = process.argv.includes('--write')

function buildSeriesIndex(families) {
  const index = new Map()
  const add = (skuCode, family) => {
    if (typeof skuCode !== 'string' || !skuCode.trim()) return
    const matches = index.get(skuCode) ?? new Map()
    matches.set(family.id, {
      seriesId: family.id,
      seriesCode: family.seriesCode || null,
      seriesName: family.seriesName || null,
    })
    index.set(skuCode, matches)
  }
  for (const family of families) {
    for (const skuCode of Object.values(family.skuMap ?? {})) add(skuCode, family)
    for (const skuCode of family.coveredSkuCodes ?? []) add(skuCode, family)
  }
  return index
}

function exactSeriesMatch(skuCode, index) {
  const matches = Array.from(index.get(skuCode)?.values() ?? [])
  if (matches.length === 1) return { status: 'exact_unique', seriesId: matches[0].seriesId, candidates: matches }
  if (matches.length > 1) return { status: 'exact_conflict', seriesId: null, candidates: matches }
  return { status: 'unmatched', seriesId: null, candidates: [] }
}

function sameSeriesMatch(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

async function main() {
  const [catalogRaw, familiesRaw, mappingRaw] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8'),
    readFile(FAMILIES_PATH, 'utf8'),
    readFile(MAPPING_PATH, 'utf8'),
  ])
  const catalog = JSON.parse(catalogRaw)
  const families = JSON.parse(familiesRaw)
  const mapping = JSON.parse(mappingRaw)
  if (!Array.isArray(catalog) || !Array.isArray(families) || !Array.isArray(mapping.items)) {
    throw new Error('catalog、families 或 mapping.items 格式錯誤')
  }

  const catalogCodes = new Set(catalog.map((item) => item.code))
  const mappingCodes = new Set(mapping.items.map((item) => item.skuCode))
  const missingMapping = catalog.filter((item) => !mappingCodes.has(item.code)).map((item) => item.code)
  const extraMapping = mapping.items.filter((item) => !catalogCodes.has(item.skuCode)).map((item) => item.skuCode)
  if (missingMapping.length > 0 || extraMapping.length > 0) {
    throw new Error(`mapping 與 catalog 不同步：缺少 ${missingMapping.length}、多出 ${extraMapping.length}`)
  }

  const seriesIndex = buildSeriesIndex(families)
  const conflicts = []
  const changes = []
  const nextItems = mapping.items.map((item) => {
    const nextMatch = exactSeriesMatch(item.skuCode, seriesIndex)
    if (nextMatch.status === 'exact_conflict') conflicts.push({ skuCode: item.skuCode, candidates: nextMatch.candidates })
    if (!sameSeriesMatch(item.seriesMatch, nextMatch) || item.taxonomy?.seriesId !== nextMatch.seriesId) {
      changes.push({
        skuCode: item.skuCode,
        previousSeriesId: item.taxonomy?.seriesId ?? null,
        nextSeriesId: nextMatch.seriesId,
        previousStatus: item.seriesMatch?.status ?? null,
        nextStatus: nextMatch.status,
      })
    }
    return {
      ...item,
      taxonomy: { ...item.taxonomy, seriesId: nextMatch.seriesId },
      seriesMatch: nextMatch,
    }
  })

  console.log(JSON.stringify({
    mode: WRITE_MODE ? 'write' : 'dry-run',
    catalogRows: catalog.length,
    mappingRows: mapping.items.length,
    familyRows: families.length,
    changedRows: changes.length,
    conflictRows: conflicts.length,
    first20: changes.slice(0, 20),
  }, null, 2))
  if (conflicts.length > 0) throw new Error(`發現 ${conflicts.length} 筆跨系列衝突，停止刷新索引`)
  if (!WRITE_MODE) return

  const { items: _items, ...header } = mapping
  const output = `${JSON.stringify(header, null, 2).slice(0, -2)},\n  "items": [\n${nextItems
    .map((item) => `    ${JSON.stringify(item)}`)
    .join(',\n')}\n  ]\n}\n`
  await writeFile(MAPPING_PATH, output)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
