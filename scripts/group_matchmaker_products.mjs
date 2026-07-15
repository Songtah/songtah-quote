#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = resolve(ROOT, 'public/products_catalog.json')
const FAMILIES_PATH = resolve(ROOT, 'public/product_families.json')
const WRITE_MODE = process.argv.includes('--write')
const REPORT_JSON_PATH = resolve(ROOT, WRITE_MODE ? 'tmp/matchmaker-write-report.json' : 'tmp/matchmaker-dry-run.json')
const REPORT_MD_PATH = resolve(ROOT, WRITE_MODE ? 'tmp/matchmaker-write-report.md' : 'tmp/matchmaker-dry-run.md')

const COLLECTION_NAME = 'Matchmaker'
const BRAND = 'Davis Schottlander'

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNamedTarget(item) {
  return item.brand === BRAND && (
    /matchmaker/i.test(item.name) ||
    item.code.startsWith('DSD-ZR') ||
    isOfficialMcItem(item)
  )
}

function isOfficialMcItem(item) {
  return (
    /^DSD-CT(?:1|2|3|5|7)-15$/.test(item.code) ||
    /^DSD-MM[1-9]-15$/.test(item.code) ||
    item.code === 'DSD-OC3-15' ||
    /^DSD-OD3[1-7]-15$/.test(item.code) ||
    /^DSD-OPAL-(?:Neutral|OL(?:7|8|9|10))$/.test(item.code) ||
    (item.code.startsWith('DSD-PRO-') && /propaque\s+paste/i.test(item.name))
  )
}

function isExistingMatchmakerFamily(family) {
  return family.brand === BRAND && /matchmaker|^ZR\s+(?:Dentin|Detin|Emamel)/i.test(family.seriesName)
}

function explicitCodes(family) {
  return Array.from(new Set([
    ...Object.values(family.skuMap ?? {}),
    ...(family.coveredSkuCodes ?? []),
  ].filter(Boolean)))
}

function mode(values) {
  const counts = new Map()
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW'))[0]?.[0] ?? ''
}

function packageSize(name) {
  const match = normalize(name).match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/i)
  return match ? `${match[1]}${match[2].toLowerCase()}` : ''
}

function withoutPackage(name) {
  return normalize(name)
    .replace(/[(/\s]*\d+(?:\.\d+)?\s*(?:g|ml)\)?/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function systemOf(item) {
  if (/press\s*zr/i.test(item.name) || item.code.startsWith('DSD-ZR-21-')) return 'press-zr'
  if (item.code.startsWith('DSD-ZR')) return 'zr'
  if (isOfficialMcItem(item)) return 'mc'
  if (/matchmaker\s+mc\b/i.test(item.name)) return 'mc'
  return 'matchmaker'
}

function roleOf(item) {
  const name = normalize(item.name)
  if (/press\s*zr/i.test(name) || item.code.startsWith('DSD-ZR-21-')) return 'press-ingot'
  if (item.code === 'DSD-ZR-04-1' || /\b(?:kit|set)\b/i.test(name)) return 'kit'
  if (/glaze/i.test(name)) return 'glaze'
  if (/liquid|luquid|專用液/i.test(name)) return 'liquid'
  if (/stain/i.test(name)) return 'stain'
  if (/pontic\s*fill/i.test(name)) return 'pontic-fill'
  if (/enhancer/i.test(name)) return 'enhancer'
  if (/\bopa\s*body\b/i.test(name)) return 'opacious-dentine'
  if (/propaque\s+paste/i.test(name)) return 'propaque'
  if (/opac(?:que)?\s*den|opaque/i.test(name)) return 'opaque'
  if (/dentin|detin|dentine|\bbody\b/i.test(name)) return 'dentine'
  if (/enamel|emamel/i.test(name)) return 'enamel'
  if (/shoulder/i.test(name)) return 'shoulder'
  if (/gingival/i.test(name)) return 'gingival'
  if (/opal/i.test(name)) return 'opal'
  if (/col\s*tran|\btranslucent\b/i.test(name)) return 'translucent'
  if (/liner/i.test(name)) return 'liner'
  if (/mamelon/i.test(name)) return 'mamelon'
  if (/modifier/i.test(name)) return 'modifier'
  if (/neck\s*den/i.test(name)) return 'neck-dentine'
  if (/occlusal/i.test(name)) return 'occlusal'
  if (/fluorescent/i.test(name)) return 'fluorescent'
  if (/\b(?:rye|amber)\b/i.test(name)) return 'effect'
  return 'other'
}

function groupKeyOf(item) {
  const system = systemOf(item)
  const role = roleOf(item)
  if (system === 'matchmaker' && role === 'stain') {
    return `${system}:${role}:${item.code.includes('-0086-') ? '0086' : '16-color'}`
  }
  // 15/50g 與明示 MC 的 250g 使用相同貨號基幹，合併後才可先選色號再選克數。
  if (role === 'enamel' && system === 'matchmaker' && /^DSD-(?:E|TCO|TE)/.test(item.code)) {
    return `mc:${role}`
  }
  return `${system}:${role}`
}

const ROLE_META = {
  'press-ingot': { title: '瓷錠', firstLabel: '色號' },
  kit: { title: '套裝組', firstLabel: '套裝' },
  liquid: { title: '專用液', firstLabel: '用途' },
  glaze: { title: 'Glaze 釉材', firstLabel: '品項' },
  stain: { title: 'Stain 上色材', firstLabel: '色號' },
  'pontic-fill': { title: 'Pontic Fill', firstLabel: '品項' },
  enhancer: { title: 'Enhancer 增強瓷粉', firstLabel: '色號' },
  'opacious-dentine': { title: 'Opacious Dentine 高遮色牙本質瓷粉', firstLabel: '色號' },
  propaque: { title: 'Propaque Paste Opaque 遮色膏', firstLabel: '色號' },
  opaque: { title: 'Opaque 遮色瓷粉', firstLabel: '色號' },
  dentine: { title: 'Dentine / Body 牙本質瓷粉', firstLabel: '色號' },
  enamel: { title: 'Enamel 琺瑯質瓷粉', firstLabel: '色號' },
  shoulder: { title: 'Shoulder 肩台瓷粉', firstLabel: '色號' },
  gingival: { title: 'Gingival 牙齦瓷粉', firstLabel: '色號' },
  opal: { title: 'Opal 乳光瓷粉', firstLabel: '色號' },
  translucent: { title: 'Coloured Translucent 透明瓷粉', firstLabel: '色號' },
  liner: { title: 'Liner 襯底瓷粉', firstLabel: '色號' },
  mamelon: { title: 'Mamelon 牙本質效果瓷粉', firstLabel: '色號' },
  modifier: { title: 'Modifier 修飾瓷粉', firstLabel: '色號' },
  'neck-dentine': { title: 'Neck Dentine 頸部瓷粉', firstLabel: '色號' },
  occlusal: { title: 'Occlusal 咬合面瓷粉', firstLabel: '色號' },
  fluorescent: { title: 'Fluorescent 螢光瓷粉', firstLabel: '色號' },
  effect: { title: 'Effect 效果瓷粉', firstLabel: '色號' },
  other: { title: '其他材料', firstLabel: '品項' },
}

const SYSTEM_META = {
  'press-zr': { title: 'Matchmaker Press Zr', code: 'PRESS-ZR' },
  zr: { title: 'Matchmaker Zr', code: 'ZR' },
  mc: { title: 'Matchmaker MC', code: 'MC' },
  matchmaker: { title: 'Matchmaker', code: 'BASE' },
}

function firstOption(item, role) {
  const name = withoutPackage(item.name)
  const patterns = {
    'press-ingot': /press\s*zr\s+([^\s]+)/i,
    enhancer: /enhancer\s+([^\s/]+)/i,
    opaque: /(?:opac(?:que)?\s*den|opaque)\s+([^\s/]+)/i,
    dentine: /(?:dentin(?:e)?|detin|body)\s+([^\s/]+)/i,
    enamel: /(?:enamel|emamel)\s+(.+)$/i,
    shoulder: /shoulder\s+([^\s/]+)/i,
    gingival: /gingival\s+([^\s/]+)/i,
    opal: /opal\s+(.+)$/i,
    translucent: /(?:col\s*tran|translucent)\s+([^\s/]+)/i,
    liner: /liner\s+([^\s/]+)/i,
    mamelon: /mamelon\s+([^\s/]+)/i,
    modifier: /modifiers?\s+([^\s/]+)/i,
    'opacious-dentine': /\b(OD3[1-7])\b/i,
    'neck-dentine': /neck\s*den\s+([^\s/]+)/i,
    occlusal: /occlusal\s+([^\s/]+)/i,
    fluorescent: /fluorescent\s+([^\s/]+)/i,
  }
  const match = patterns[role]?.exec(name)
  if (role === 'opal' && item.code.startsWith('DSD-OPAL-')) {
    return item.code === 'DSD-OPAL-Neutral' ? 'Neutral' : item.code.replace('DSD-OPAL-', '')
  }
  if (match?.[1]) return normalize(match[1]).replace(/^nertral$/i, 'Neutral')
  if (role === 'propaque') {
    if (item.code === 'DSD-PRO-1') return 'Blossom'
    return item.code.replace(/^DSD-PRO-O/, '')
  }
  if (role === 'stain') return normalize(name.replace(/^.*?stain\s*/i, ''))
  if (role === 'liquid') {
    if (/body\s*plus/i.test(name)) return 'Body Plus'
    if (/body/i.test(name)) return 'Body'
    if (/opaque/i.test(name)) return 'Opaque'
    if (/modelling/i.test(name)) return 'Modelling'
    if (/stain/i.test(name)) return 'Stain'
  }
  if (role === 'glaze') {
    if (/powder/i.test(name)) return 'Powder 釉粉'
    if (/liquid/i.test(name)) return 'Liquid 釉水'
    return 'Glaze 釉材'
  }
  if (role === 'kit') {
    if (item.code === 'DSD-ZR-04-1') return '全色系補充品'
    return normalize(name)
      .replace(/^matchmaker\s*/i, '')
      .replace(/^zr\s*/i, '')
      .replace(/^mc\s*/i, '')
      .replace(/\b(?:kit|set)\b/ig, '')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || item.code
  }
  if (role === 'pontic-fill') return 'Pontic Fill'
  if (role === 'effect') return normalize(name.replace(/^matchmaker\s*/i, ''))
  return normalize(name.replace(/^matchmaker\s*/i, '').replace(/^zr\s*/i, '')) || item.code
}

function familyDefinition(groupKey, items) {
  const [system, role, variant] = groupKey.split(':')
  const roleMeta = ROLE_META[role]
  const systemMeta = SYSTEM_META[system]
  let seriesName = `${systemMeta.title} ${roleMeta.title}`
  let variantCode = ''
  if (variant === '0086') {
    seriesName = 'Matchmaker Stain 0086 色組'
    variantCode = '-0086'
  } else if (variant === '16-color') {
    seriesName = 'Matchmaker Stain 16 色組'
    variantCode = '-16'
  }

  const rows = items.map((item) => ({
    item,
    option: firstOption(item, role),
    package: packageSize(item.name),
  }))
  const rawKeyCounts = new Map()
  for (const row of rows) {
    const key = row.package ? `${row.option}|${row.package}` : row.option
    rawKeyCounts.set(key, (rawKeyCounts.get(key) ?? 0) + 1)
  }
  for (const row of rows) {
    const rawKey = row.package ? `${row.option}|${row.package}` : row.option
    if ((rawKeyCounts.get(rawKey) ?? 0) > 1) row.option = `${row.option}（${row.item.code}）`
  }

  const collator = new Intl.Collator('zh-TW', { numeric: true, sensitivity: 'base' })
  const firstOptions = Array.from(new Set(rows.map((row) => row.option))).sort(collator.compare)
  const packages = Array.from(new Set(rows.map((row) => row.package).filter(Boolean))).sort(collator.compare)
  const skuMap = Object.fromEntries(rows
    .sort((a, b) => collator.compare(a.option, b.option) || collator.compare(a.package, b.package))
    .map((row) => [row.package ? `${row.option}|${row.package}` : row.option, row.item.code]))
  const skuNameMap = Object.fromEntries(rows.map((row) => [row.item.code, row.item.name]))
  const specs = [{ key: roleMeta.firstLabel, label: roleMeta.firstLabel, options: firstOptions }]
  if (packages.length > 0) specs.push({ key: '包裝', label: '重量 / 容量', options: packages })
  const seriesCode = `DSD-MATCHMAKER-${systemMeta.code}-${role.toUpperCase()}${variantCode}`
  return {
    id: seriesCode,
    collectionName: COLLECTION_NAME,
    seriesCode,
    seriesName,
    brand: BRAND,
    productType: mode(items.map((item) => item.productType)),
    category: mode(items.map((item) => item.category)),
    skuPattern: '',
    namePattern: `{${roleMeta.firstLabel}}${packages.length > 0 ? ' {包裝}' : ''}`,
    specs,
    skuMap,
    skuNameMap,
  }
}

async function loadManualAssignments(targetCodes) {
  const configured = Boolean(process.env.NOTION_TOKEN && process.env.NOTION_PRODUCTS_DB)
  if (!configured) return { configured: false, assignments: [] }
  const { Client } = await import('@notionhq/client')
  const notion = new Client({ auth: process.env.NOTION_TOKEN })
  const assignments = []
  let cursor
  do {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_PRODUCTS_DB,
      filter: { property: '系列群組', rich_text: { is_not_empty: true } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of response.results ?? []) {
      const text = (field) => (page.properties?.[field]?.rich_text ?? []).map((part) => part.plain_text ?? '').join('')
      const skuCode = text('貨號')
      if (targetCodes.has(skuCode)) assignments.push({ skuCode, familyId: text('系列群組') })
    }
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)
  return { configured: true, assignments }
}

function markdownReport(report) {
  const lines = [
    '# Davis Schottlander Matchmaker 系列重組 dry-run',
    '',
    `- 模式：${report.mode}`,
    `- 目錄現有欄位：${report.catalogFields.join('、')}`,
    `- 系列現有欄位：${report.familyFields.join('、')}`,
    `- 影響 SKU：${report.targetSkuCount}`,
    `- 現有相關系列：${report.touchedFamilyCount}`,
    `- 預計移除空舊系列：${report.removedFamilyCount}`,
    `- 預計建立新系列：${report.newFamilyCount}`,
    `- Notion 手動歸屬已載入：${report.notionAssignmentsLoaded ? '是' : '否'}`,
    `- 目標 SKU 的 Notion 手動歸屬：${report.manualAssignmentCount}`,
    `- 分類遺漏：${report.unassignedCount}`,
    `- 新系列內重複規格鍵：${report.duplicateSpecKeyCount}`,
    `- 重組後跨系列 SKU 衝突：${report.finalConflictCount}`,
    '',
    '## 新系列統計',
    '',
    ...report.newFamilies.map((family) => `- ${family.seriesName}：${family.skuCount} 筆；${family.specs.map((spec) => `${spec.label} ${spec.optionCount}`).join(' → ')}`),
    '',
    '## 前 20 筆樣本',
    '',
    '| 貨號 | ERP 品名（不修改） | 新系列 | 第一層 | 包裝 |',
    '|---|---|---|---|---|',
    ...report.first20.map((row) => `| ${row.code} | ${row.name.replaceAll('|', '\\|')} | ${row.seriesName} | ${row.option.replaceAll('|', '\\|')} | ${row.package || '—'} |`),
    '',
    '## 將移除的空舊系列',
    '',
    ...report.removedFamilies.map((family) => `- ${family.id}｜${family.seriesName}｜原有 ${family.targetSkuCount} 筆目標 SKU`),
  ]
  return `${lines.join('\n')}\n`
}

async function main() {
  const [catalogRaw, familiesRaw] = await Promise.all([
    readFile(CATALOG_PATH, 'utf8'),
    readFile(FAMILIES_PATH, 'utf8'),
  ])
  const catalog = JSON.parse(catalogRaw)
  const families = JSON.parse(familiesRaw)
  const existingRelatedCodes = new Set(
    families.filter(isExistingMatchmakerFamily).flatMap(explicitCodes),
  )
  const targets = catalog
    .filter((item) => isNamedTarget(item) || existingRelatedCodes.has(item.code))
    .sort((a, b) => a.code.localeCompare(b.code))
  const targetCodes = new Set(targets.map((item) => item.code))
  const manualResult = await loadManualAssignments(targetCodes)
  if (WRITE_MODE && !manualResult.configured) throw new Error('寫入前必須載入 .env.local，以檢查正式 Notion 手動系列歸屬')
  if (manualResult.assignments.length > 0) {
    throw new Error(`有 ${manualResult.assignments.length} 筆目標 SKU 存在 Notion 手動系列歸屬，停止自動重組`)
  }

  const buckets = new Map()
  for (const item of targets) {
    const key = groupKeyOf(item)
    const rows = buckets.get(key) ?? []
    rows.push(item)
    buckets.set(key, rows)
  }
  const newFamilies = [...buckets.entries()]
    .map(([key, items]) => familyDefinition(key, items))
    .sort((a, b) => a.seriesName.localeCompare(b.seriesName, 'zh-TW'))

  const touchedFamilies = []
  const retainedFamilies = []
  for (const family of families) {
    const memberCodes = explicitCodes(family)
    const targetMemberCodes = memberCodes.filter((code) => targetCodes.has(code))
    if (targetMemberCodes.length === 0) {
      retainedFamilies.push(family)
      continue
    }
    const nonTargetMemberCodes = memberCodes.filter((code) => !targetCodes.has(code))
    touchedFamilies.push({
      id: family.id,
      seriesName: family.seriesName,
      targetSkuCount: targetMemberCodes.length,
      nonTargetMemberCodes,
    })
    if (nonTargetMemberCodes.length > 0) {
      throw new Error(`舊系列 ${family.id} 同時包含 ${nonTargetMemberCodes.length} 筆非 Matchmaker SKU，停止避免破壞其他系列`)
    }
  }

  const newOwners = new Map()
  let duplicateSpecKeyCount = 0
  for (const family of newFamilies) {
    const keys = Object.keys(family.skuMap)
    duplicateSpecKeyCount += keys.length - new Set(keys).size
    for (const code of Object.values(family.skuMap)) {
      const owners = newOwners.get(code) ?? []
      owners.push(family.id)
      newOwners.set(code, owners)
    }
  }
  const unassigned = targets.filter((item) => !newOwners.has(item.code))
  const nextFamilies = [...retainedFamilies, ...newFamilies]
  const finalOwners = new Map()
  for (const family of nextFamilies) {
    for (const code of explicitCodes(family)) {
      const owners = finalOwners.get(code) ?? []
      owners.push(family.id)
      finalOwners.set(code, owners)
    }
  }
  const finalConflicts = [...finalOwners.entries()].filter(([, owners]) => new Set(owners).size > 1)
  const rowByCode = new Map()
  for (const family of newFamilies) {
    for (const [key, code] of Object.entries(family.skuMap)) {
      const [option, packageValue = ''] = key.split('|')
      rowByCode.set(code, { seriesName: family.seriesName, option, package: packageValue })
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: WRITE_MODE ? 'write' : 'dry-run',
    catalogFields: [...new Set(catalog.flatMap((item) => Object.keys(item)))].sort(),
    familyFields: [...new Set(families.flatMap((family) => Object.keys(family)))].sort(),
    targetSkuCount: targets.length,
    touchedFamilyCount: touchedFamilies.length,
    removedFamilyCount: touchedFamilies.length,
    newFamilyCount: newFamilies.length,
    notionAssignmentsLoaded: manualResult.configured,
    manualAssignmentCount: manualResult.assignments.length,
    unassignedCount: unassigned.length,
    duplicateSpecKeyCount,
    finalConflictCount: finalConflicts.length,
    newFamilies: newFamilies.map((family) => ({
      id: family.id,
      seriesName: family.seriesName,
      skuCount: Object.keys(family.skuMap).length,
      specs: family.specs.map((spec) => ({ label: spec.label, optionCount: spec.options.length })),
    })),
    first20: targets.slice(0, 20).map((item) => ({ ...item, ...rowByCode.get(item.code) })),
    removedFamilies: touchedFamilies,
    unassigned: unassigned.map((item) => ({ code: item.code, name: item.name })),
    finalConflicts: finalConflicts.map(([code, owners]) => ({ code, owners })),
  }

  if (unassigned.length > 0 || duplicateSpecKeyCount > 0 || finalConflicts.length > 0) {
    throw new Error(`安全檢查未通過：未歸組 ${unassigned.length}、規格鍵重複 ${duplicateSpecKeyCount}、跨系列衝突 ${finalConflicts.length}`)
  }

  await mkdir(resolve(ROOT, 'tmp'), { recursive: true })
  await Promise.all([
    writeFile(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(REPORT_MD_PATH, markdownReport(report)),
  ])
  if (WRITE_MODE) await writeFile(FAMILIES_PATH, `${JSON.stringify(nextFamilies, null, 2)}\n`)

  console.log(JSON.stringify({
    mode: report.mode,
    targetSkuCount: report.targetSkuCount,
    touchedFamilyCount: report.touchedFamilyCount,
    removedFamilyCount: report.removedFamilyCount,
    newFamilyCount: report.newFamilyCount,
    notionAssignmentsLoaded: report.notionAssignmentsLoaded,
    manualAssignmentCount: report.manualAssignmentCount,
    unassignedCount: report.unassignedCount,
    duplicateSpecKeyCount: report.duplicateSpecKeyCount,
    finalConflictCount: report.finalConflictCount,
    reportJson: REPORT_JSON_PATH,
    reportMarkdown: REPORT_MD_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
