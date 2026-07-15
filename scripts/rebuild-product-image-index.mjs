import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { Redis } from '@upstash/redis'
import { get, head, put } from '@vercel/blob'

const ROOT = process.cwd()
const VERSION_KEY = 'products:image-index:active-version'
const BUILDING_VERSION_KEY = 'products:image-index:building-version'
const REBUILD_LOCK_KEY = 'products:image-index:rebuild-lock'
const DIRTY_KEY = 'products:image-index:dirty'
const SHARDS_KEY = 'products:image-index:active-shards'
const KEY_PREFIX = 'products:image-index'
const MAX_PARTITION_ROWS = 9_900

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

function richText(property) {
  return (property?.rich_text ?? []).map((part) => part.plain_text ?? '').join('')
}

function shardKey(version, manufacturer) {
  return `${KEY_PREFIX}:${version}:${encodeURIComponent(manufacturer || '__empty__')}`
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

loadEnv()
const execute = process.argv.includes('--execute')
if (!process.env.NOTION_TOKEN || !process.env.NOTION_PRODUCTS_DB) throw new Error('Notion product configuration is missing')
const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
if (execute && !hasRedis && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('Redis and Blob configurations are both missing')
}

const redis = execute && hasRedis
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null
const version = Date.now().toString()
const blobIndexUrl = 'https://irui8ert6hs4ddec.public.blob.vercel-storage.com/products/catalog/image-index.json'
const initialBlobHead = execute && process.env.BLOB_READ_WRITE_TOKEN
  ? await head(blobIndexUrl, { token: process.env.BLOB_READ_WRITE_TOKEN })
  : null
let lockAcquired = false
let switchedVersion = false
async function renewRebuildLease() {
  if (!redis) return
  const renewed = await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] and redis.call('get', KEYS[2]) == ARGV[1] then redis.call('expire', KEYS[1], ARGV[2]); redis.call('expire', KEYS[2], ARGV[2]); return 1 else return 0 end",
    [REBUILD_LOCK_KEY, BUILDING_VERSION_KEY],
    [version, '600'],
  )
  if (Number(renewed) !== 1) throw new Error('Product image index rebuild lease was lost; refusing to continue')
}
try {
if (redis) {
  const lock = await redis.eval(
    "if redis.call('exists', KEYS[1]) == 0 and redis.call('hlen', KEYS[3]) == 0 then redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]); redis.call('set', KEYS[2], ARGV[1], 'EX', ARGV[2]); return 1 else return 0 end",
    [REBUILD_LOCK_KEY, BUILDING_VERSION_KEY, DIRTY_KEY],
    [version, '600'],
  )
  if (Number(lock) !== 1) throw new Error('Another rebuild is running or product image updates still require repair')
  lockAcquired = true
  // Let writes that started before the lock finish dual-writing the building version.
  await new Promise((resolve) => setTimeout(resolve, 2_000))
}

const databaseId = process.env.NOTION_PRODUCTS_DB.replaceAll('-', '').replace('collection://', '')
const database = await notionRequest(`/databases/${databaseId}`)
const manufacturers = (database.properties?.['生產商']?.select?.options ?? [])
  .map((option) => option.name)
  .filter(Boolean)
const partitions = [
  ...manufacturers.map((manufacturer) => ({ manufacturer, filter: { property: '生產商', select: { equals: manufacturer } } })),
  { manufacturer: '__empty__', filter: { property: '生產商', select: { is_empty: true } } },
]
const shards = new Map()
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/products_catalog.json'), 'utf8'))
const catalogBrandByCode = new Map(catalog.map((item) => [item.code, item.brand || '__empty__']))
const samples = []
let rowCount = 0

for (const partition of partitions) {
  let cursor
  let partitionRows = 0
  do {
    await renewRebuildLease()
    const response = await notionRequest(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 100,
        filter: { and: [partition.filter, { property: '圖片URL', url: { is_not_empty: true } }] },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    })
    for (const page of response.results ?? []) {
      const code = richText(page.properties?.['貨號'])
      const imageUrl = page.properties?.['圖片URL']?.url ?? ''
      if (code && imageUrl) {
        const targetManufacturer = catalogBrandByCode.get(code) ?? partition.manufacturer
        const targetShard = shards.get(targetManufacturer) ?? {}
        if (targetShard[code] === undefined) targetShard[code] = imageUrl
        shards.set(targetManufacturer, targetShard)
        if (samples.length < 20) samples.push({ code, manufacturer: targetManufacturer, imageUrl })
      }
    }
    partitionRows += response.results?.length ?? 0
    if (partitionRows >= MAX_PARTITION_ROWS) throw new Error(`Partition ${partition.manufacturer} is too close to 10,000 rows`)
    cursor = response.has_more ? response.next_cursor : undefined
  } while (cursor)
  rowCount += partitionRows
}

const summary = {
  mode: execute ? 'execute' : 'dry-run',
  schemaFields: Object.keys(database.properties ?? {}),
  partitionCount: partitions.length,
  nonEmptyShards: shards.size,
  rowsWithImages: rowCount,
  uniqueSkuImages: Array.from(shards.values()).reduce((total, shard) => total + Object.keys(shard).length, 0),
  first20: samples,
}
console.log(JSON.stringify(summary, null, 2))
if (!execute) process.exit(0)

const blobImages = Object.fromEntries(
  Object.entries(Object.assign({}, ...Array.from(shards.values()))).sort(([left], [right]) => left.localeCompare(right)),
)
let blobUrl = null
if (process.env.BLOB_READ_WRITE_TOKEN) {
  await renewRebuildLease()
  const imageDigest = crypto.createHash('sha256').update(JSON.stringify(blobImages)).digest('hex')
  const payload = Buffer.from(JSON.stringify({ version: new Date().toISOString(), sha256: imageDigest, images: blobImages }))
  const blob = await put('products/catalog/image-index.json', payload, {
    access: 'public', allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json',
    ifMatch: initialBlobHead?.etag, token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  let blobReadBackVerified = false
  for (let readAttempt = 1; readAttempt <= 13 && !blobReadBackVerified; readAttempt += 1) {
    const blobReadBackResult = await get(blobIndexUrl, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN })
    if (blobReadBackResult) {
      const blobReadBack = await new Response(blobReadBackResult.stream).json()
      const readBackImages = Object.fromEntries(Object.entries(blobReadBack.images ?? {}).sort(([left], [right]) => left.localeCompare(right)))
      const readBackDigest = crypto.createHash('sha256').update(JSON.stringify(readBackImages)).digest('hex')
      blobReadBackVerified = blobReadBack.sha256 === imageDigest && readBackDigest === imageDigest
    }
    if (!blobReadBackVerified) await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  if (!blobReadBackVerified) throw new Error('Blob read-back digest mismatch after committed write')
  blobUrl = blob.url
}

if (redis) {
const oldVersion = await redis.get(VERSION_KEY)
const oldShards = await redis.get(SHARDS_KEY)
const pipeline = redis.pipeline()
for (const [manufacturer, shard] of shards) pipeline.hset(shardKey(version, manufacturer), shard)
await pipeline.exec()
const readBackPipeline = redis.pipeline()
for (const manufacturer of shards.keys()) readBackPipeline.hgetall(shardKey(version, manufacturer))
const readBackShards = await readBackPipeline.exec()
const redisImages = Object.fromEntries(
  Object.entries(Object.assign({}, ...readBackShards.filter(Boolean))).sort(([left], [right]) => left.localeCompare(right)),
)
const redisDigest = crypto.createHash('sha256').update(JSON.stringify(redisImages)).digest('hex')
const expectedRedisDigest = crypto.createHash('sha256').update(JSON.stringify(blobImages)).digest('hex')
const readBackTotal = Object.keys(redisImages).length
if (redisDigest !== expectedRedisDigest) throw new Error('Redis read-back digest mismatch')

const switched = await redis.eval(
  "if redis.call('get', KEYS[1]) == ARGV[1] and redis.call('get', KEYS[2]) == ARGV[1] then redis.call('set', KEYS[3], ARGV[2]); redis.call('set', KEYS[4], ARGV[1]); redis.call('del', KEYS[2], KEYS[1], KEYS[5]); return 1 else return 0 end",
  [REBUILD_LOCK_KEY, BUILDING_VERSION_KEY, SHARDS_KEY, VERSION_KEY, DIRTY_KEY],
  [version, JSON.stringify(Array.from(shards.keys()))],
)
if (Number(switched) !== 1) throw new Error('Product image index rebuild lease was lost before version switch')
switchedVersion = true

if (oldVersion !== null && oldVersion !== undefined && oldVersion !== version && Array.isArray(oldShards)) {
  const cleanup = redis.pipeline()
  for (const manufacturer of oldShards) cleanup.del(shardKey(oldVersion, String(manufacturer)))
  await cleanup.exec()
}
console.log(JSON.stringify({ activeVersion: version, readBackTotal, status: 'complete' }, null, 2))
} else {
  switchedVersion = true
  console.log(JSON.stringify({ blobUrl, readBackTotal: summary.uniqueSkuImages, status: 'complete' }, null, 2))
}
} finally {
  if (redis && lockAcquired && !switchedVersion) {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then if redis.call('get', KEYS[2]) == ARGV[1] then redis.call('del', KEYS[2]) end; return redis.call('del', KEYS[1]) else return 0 end",
        [REBUILD_LOCK_KEY, BUILDING_VERSION_KEY],
        [version],
      )
    } catch (cleanupError) {
      console.warn('[product-image-index] failed rebuild lock cleanup failed:', cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
  }
}
