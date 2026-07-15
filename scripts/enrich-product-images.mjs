import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { Redis } from '@upstash/redis'
import { put } from '@vercel/blob'
import sharp from 'sharp'

const ROOT = process.cwd()
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024
const MAX_REDIRECTS = 3
const MIN_SOURCE_EDGE = 600
const MAX_SOURCE_EDGE = 10_000
const MAX_INPUT_PIXELS = 40_000_000
const OUTPUT_SIZE = 1200
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const REPORT_PATH = path.join(ROOT, 'tmp/product-image-enrichment-report.json')

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index)
    if (process.env[key]) continue
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[key] = value
  }
}

function parseArgs(argv) {
  const args = { execute: false, verifyImages: false, overwrite: false, limit: Infinity, manifestPath: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--execute') args.execute = true
    else if (arg === '--verify-images') args.verifyImages = true
    else if (arg === '--overwrite') args.overwrite = true
    else if (arg === '--approved-manifest') args.manifestPath = argv[++index] ?? ''
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++index] ?? '', 10)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!args.manifestPath) throw new Error('Use --approved-manifest <path>')
  if (args.limit !== Infinity && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error('--limit must be a positive integer')
  }
  return args
}

function richText(content) {
  if (!content) return []
  return (content.match(/[\s\S]{1,1800}/g) ?? []).map((chunk) => ({ type: 'text', text: { content: chunk } }))
}

function plainText(property) {
  const parts = property?.title ?? property?.rich_text ?? []
  return parts.map((part) => part.plain_text ?? '').join('')
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase()
    if (normalized.startsWith('::ffff:')) {
      let mappedIpv4 = normalized.slice('::ffff:'.length)
      if (net.isIP(mappedIpv4) === 4) return isPrivateAddress(mappedIpv4)
      const words = mappedIpv4.split(':')
      if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
        const high = Number.parseInt(words[0], 16)
        const low = Number.parseInt(words[1], 16)
        mappedIpv4 = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
        return isPrivateAddress(mappedIpv4)
      }
    }
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
  }
  return true
}

async function assertSafeUrl(rawUrl, allowedHosts) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('Only HTTPS image URLs are allowed')
  if (!allowedHosts.has(url.hostname)) throw new Error(`Host is not approved: ${url.hostname}`)
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Host resolves to a disallowed address: ${url.hostname}`)
  }
  return url
}

async function downloadImage(rawUrl, allowedHosts) {
  let current = await assertSafeUrl(rawUrl, allowedHosts)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'SongtahProductImageAudit/1.0', Accept: 'image/webp,image/png,image/jpeg' },
    })
    if (response.status >= 300 && response.status < 400) {
      if (redirect === MAX_REDIRECTS) throw new Error('Too many redirects')
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect has no location')
      current = await assertSafeUrl(new URL(location, current).toString(), allowedHosts)
      continue
    }
    if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`)
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!CONTENT_TYPES.has(contentType)) throw new Error(`Unsupported Content-Type: ${contentType || '(missing)'}`)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error('Image exceeds 15 MB')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Image response has no body')
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel()
        throw new Error('Image stream exceeds 15 MB')
      }
      chunks.push(value)
    }
    return { buffer: Buffer.concat(chunks), contentType, finalSourceUrl: current.toString() }
  }
  throw new Error('Image download did not complete')
}

async function normalizeImage(input) {
  const pipeline = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated: false })
  const metadata = await pipeline.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height) throw new Error('Image dimensions are missing')
  if ((metadata.pages ?? 1) > 1) throw new Error('Animated or multi-page images are not allowed')
  if (Math.min(width, height) < MIN_SOURCE_EDGE) throw new Error(`Source image is below ${MIN_SOURCE_EDGE}px on one edge`)
  if (Math.max(width, height) > MAX_SOURCE_EDGE) throw new Error(`Source image exceeds ${MAX_SOURCE_EDGE}px`)
  const output = await pipeline
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: '#ffffff', withoutEnlargement: false })
    .webp({ quality: 86, effort: 5 })
    .toBuffer()
  return { output, sourceWidth: width, sourceHeight: height }
}

async function notionRequest(apiPath, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Notion ${apiPath} failed: ${response.status} ${data.message ?? ''}`.trim())
  return data
}

async function updateProductImageIndex(item, imageUrl) {
  // Blob is rebuilt once from authoritative Notion after the batch. Per-item
  // read-modify-write is unsafe while the public Blob CDN may serve an older body.
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return
  try {
    const redis = new Redis({ url, token })
    const [activeVersion, buildingVersion] = await redis.mget(
      'products:image-index:active-version',
      'products:image-index:building-version',
    )
    const versions = Array.from(new Set([activeVersion, buildingVersion].filter((version) => version !== null && version !== undefined)))
    if (versions.length === 0) return
    const pipeline = redis.pipeline()
    for (const version of versions) {
      const shard = `products:image-index:${version}:${encodeURIComponent(item.brand || '__empty__')}`
      pipeline.hset(shard, { [item.code]: imageUrl })
    }
    pipeline.hdel('products:image-index:dirty', item.code)
    await pipeline.exec()
  } catch (error) {
    console.warn('[product-images] image index projection update failed:', error instanceof Error ? error.message : String(error))
  }
}

async function markProductImageIndexDirty(item) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return
  try {
    const redis = new Redis({ url, token })
    const marked = await redis.eval(
      "if redis.call('exists', KEYS[1]) == 0 then redis.call('hset', KEYS[2], ARGV[1], ARGV[2]); return 1 else return 0 end",
      ['products:image-index:rebuild-lock', 'products:image-index:dirty'],
      [item.code, new Date().toISOString()],
    )
    if (Number(marked) !== 1) throw new Error('Product image index rebuild is running')
  } catch (error) {
    if (error instanceof Error && error.message.includes('rebuild is running')) throw error
    throw new Error(`Product image index dirty marker failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function getProductPage(code) {
  const data = await notionRequest(`/databases/${process.env.NOTION_PRODUCTS_DB.replaceAll('-', '').replace('collection://', '')}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 3, filter: { property: '貨號', rich_text: { equals: code } } }),
  })
  if ((data.results ?? []).length > 1) throw new Error(`Duplicate Notion product rows: ${code}`)
  return data.results?.[0] ?? null
}

function productSnapshot(page) {
  if (!page) return null
  return {
    id: page.id,
    code: plainText(page.properties?.['貨號']),
    name: plainText(page.properties?.['Name']),
    imageUrl: page.properties?.['圖片URL']?.url ?? '',
  }
}

async function writeProductImage(item, catalogItem, blobUrl, existingPage) {
  const properties = { 圖片URL: { url: blobUrl } }
  if (existingPage) {
    await notionRequest(`/pages/${existingPage.id}`, { method: 'PATCH', body: JSON.stringify({ properties }) })
    return existingPage.id
  }
  const created = await notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_PRODUCTS_DB.replace('collection://', '') },
      properties: {
        Name: { title: richText(catalogItem.name) },
        貨號: { rich_text: richText(item.code) },
        生產商: { select: { name: catalogItem.brand || '其他' } },
        系列: { select: { name: catalogItem.category || '其他' } },
        類型: { select: { name: catalogItem.productType || '其他' } },
        ...properties,
      },
    }),
  })
  return created.id
}

let auditDatabaseId
async function resolveAuditDatabase() {
  if (auditDatabaseId) return auditDatabaseId
  if (process.env.NOTION_AUDIT_LOGS_DB) {
    auditDatabaseId = process.env.NOTION_AUDIT_LOGS_DB.replace('collection://', '')
    return auditDatabaseId
  }
  const search = await notionRequest('/search', {
    method: 'POST',
    body: JSON.stringify({ query: '系統操作紀錄', filter: { property: 'object', value: 'database' }, page_size: 20 }),
  })
  const found = (search.results ?? []).find((database) =>
    (database.title ?? []).map((part) => part.plain_text ?? '').join('') === '系統操作紀錄')
  if (!found) throw new Error('Audit database was not found')
  auditDatabaseId = found.id
  return auditDatabaseId
}

async function logAudit(item, before, after, metadata) {
  const databaseId = await resolveAuditDatabase()
  await notionRequest('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        事件標題: { title: richText(`批次補齊產品圖片：${item.code}`) },
        發生時間: { date: { start: new Date().toISOString() } },
        模組: { rich_text: richText('products') },
        操作: { rich_text: richText('update') },
        實體類型: { rich_text: richText('product-image') },
        實體ID: { rich_text: richText(item.code) },
        實體名稱: { rich_text: richText(item.name) },
        執行者: { rich_text: richText('Codex 批次圖片工具') },
        角色: { rich_text: richText('中央管理') },
        摘要: { rich_text: richText(`官方圖片正規化並寫入：${item.code}`) },
        路徑: { rich_text: richText('scripts/enrich-product-images.mjs') },
        請求方法: { rich_text: richText('BATCH') },
      },
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: richText(`變更前\n${JSON.stringify(before)}\n變更後\n${JSON.stringify(after)}\n來源\n${JSON.stringify(metadata)}`) },
      }],
    }),
  })
}

async function hasProductImageAudit(code) {
  const databaseId = await resolveAuditDatabase()
  const data = await notionRequest(`/databases/${databaseId.replaceAll('-', '')}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 1,
      filter: { and: [
        { property: '實體ID', rich_text: { equals: code } },
        { property: '實體類型', rich_text: { equals: 'product-image' } },
      ] },
    }),
  })
  return (data.results ?? []).length > 0
}

function validateManifest(manifest, catalogByCode) {
  if (manifest?.approval?.reuseAuthorized !== true) throw new Error('Manifest must record reuseAuthorized=true')
  const hostsByBrand = manifest.allowedHostsByBrand ?? {}
  const seen = new Set()
  for (const item of manifest.items ?? []) {
    if (!item.code || seen.has(item.code)) throw new Error(`Duplicate or missing code: ${item.code}`)
    seen.add(item.code)
    const catalogItem = catalogByCode.get(item.code)
    if (!catalogItem) throw new Error(`Unknown catalog code: ${item.code}`)
    if (catalogItem.brand !== item.brand) throw new Error(`Brand mismatch: ${item.code}`)
    if (item.decision !== 'approved' || item.confidence !== 'high') throw new Error(`Only approved high-confidence items are allowed: ${item.code}`)
    if (!item.sourcePageUrl || !item.sourceImageUrl) throw new Error(`Source evidence is incomplete: ${item.code}`)
    const allowedHosts = new Set(hostsByBrand[item.brand] ?? [])
    if (!allowedHosts.has(new URL(item.sourcePageUrl).hostname) || !allowedHosts.has(new URL(item.sourceImageUrl).hostname)) {
      throw new Error(`Source host is not approved for ${item.code}`)
    }
  }
}

loadEnv()
const args = parseArgs(process.argv.slice(2))
if (!process.env.NOTION_TOKEN || !process.env.NOTION_PRODUCTS_DB) throw new Error('Notion product configuration is missing')
if (args.execute && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is missing')

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/products_catalog.json'), 'utf8'))
const catalogByCode = new Map(catalog.map((item) => [item.code, item]))
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.manifestPath), 'utf8'))
validateManifest(manifest, catalogByCode)
const selected = manifest.items.slice(0, args.limit)
const report = {
  generatedAt: new Date().toISOString(),
  mode: args.execute ? 'execute' : args.verifyImages ? 'verify-images' : 'dry-run',
  manifest: args.manifestPath,
  totals: { selected: selected.length, verified: 0, written: 0, skipped: 0, failed: 0 },
  items: [],
}

function saveReport() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
process.on('SIGINT', () => { saveReport(); process.exit(130) })

for (const item of selected) {
  const result = { code: item.code, name: item.name, sourcePageUrl: item.sourcePageUrl, sourceImageUrl: item.sourceImageUrl, status: 'dry-run' }
  report.items.push(result)
  let mutationStarted = false
  try {
    const existingPage = await getProductPage(item.code)
    const before = productSnapshot(existingPage)
    result.before = before
    if (before?.imageUrl && !args.overwrite) {
      result.status = 'skipped-existing'
      if (args.execute && !(await hasProductImageAudit(item.code))) {
        const allowedHosts = new Set(manifest.allowedHostsByBrand[item.brand])
        const downloaded = await downloadImage(item.sourceImageUrl, allowedHosts)
        const normalized = await normalizeImage(downloaded.buffer)
        const hash = crypto.createHash('sha256').update(normalized.output).digest('hex')
        const existingUrl = new URL(before.imageUrl)
        const expectedSuffix = `/products/catalog/${hash}.webp`
        if (!existingUrl.hostname.endsWith('.public.blob.vercel-storage.com') || existingUrl.pathname !== expectedSuffix) {
          throw new Error(`Existing image has no audit and does not match the approved normalized source: ${item.code}`)
        }
        mutationStarted = true
        await logAudit(item, before, before, {
          sourcePageUrl: item.sourcePageUrl,
          sourceImageUrl: downloaded.finalSourceUrl,
          sha256: hash,
          normalized: `${OUTPUT_SIZE}x${OUTPUT_SIZE} webp`,
          recovery: 'reconciled-existing-image-after-interrupted-batch',
        })
        result.status = 'audit-repaired'
      }
      report.totals.skipped += 1
      saveReport()
      continue
    }
    if (!args.verifyImages && !args.execute) {
      saveReport()
      continue
    }
    const allowedHosts = new Set(manifest.allowedHostsByBrand[item.brand])
    const downloaded = await downloadImage(item.sourceImageUrl, allowedHosts)
    const normalized = await normalizeImage(downloaded.buffer)
    const hash = crypto.createHash('sha256').update(normalized.output).digest('hex')
    Object.assign(result, {
      status: args.execute ? 'verified' : 'verified-only',
      finalSourceUrl: downloaded.finalSourceUrl,
      sourceContentType: downloaded.contentType,
      sourceWidth: normalized.sourceWidth,
      sourceHeight: normalized.sourceHeight,
      outputWidth: OUTPUT_SIZE,
      outputHeight: OUTPUT_SIZE,
      outputBytes: normalized.output.byteLength,
      sha256: hash,
    })
    report.totals.verified += 1
    if (!args.execute) {
      saveReport()
      continue
    }
    const blob = await put(`products/catalog/${hash}.webp`, normalized.output, {
      access: 'public', allowOverwrite: true, contentType: 'image/webp', token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    mutationStarted = true
    result.blobUrl = blob.url
    await markProductImageIndexDirty(item)
    const pageId = await writeProductImage(item, catalogByCode.get(item.code), blob.url, existingPage)
    await updateProductImageIndex(item, blob.url)
    const afterPage = await notionRequest(`/pages/${pageId}`)
    const after = productSnapshot(afterPage)
    result.after = after
    if (after?.imageUrl !== blob.url) throw new Error('Notion image URL read-back mismatch')
    await logAudit(item, before, after, {
      sourcePageUrl: item.sourcePageUrl,
      sourceImageUrl: downloaded.finalSourceUrl,
      sha256: hash,
      normalized: `${OUTPUT_SIZE}x${OUTPUT_SIZE} webp`,
    })
    result.status = 'written'
    report.totals.written += 1
  } catch (error) {
    result.status = 'failed'
    result.error = error instanceof Error ? error.message : String(error)
    report.totals.failed += 1
    saveReport()
    if (args.execute && mutationStarted) throw error
    continue
  }
  saveReport()
}

saveReport()
console.log(JSON.stringify({ ...report.totals, reportPath: REPORT_PATH, mode: report.mode }, null, 2))
