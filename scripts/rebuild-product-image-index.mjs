import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Redis } from '@upstash/redis'

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
if (execute && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
  throw new Error('Redis configuration is missing')
}

const redis = execute
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null
const version = Date.now().toString()
let lockAcquired = false
let switchedVersion = false
try {
if (redis) {
  const lock = await redis.set(REBUILD_LOCK_KEY, version, { nx: true, ex: 600 })
  if (lock !== 'OK') throw new Error('Another product image index rebuild is already running')
  lockAcquired = true
  await redis.set(BUILDING_VERSION_KEY, version, { ex: 600 })
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

const oldVersion = await redis.get(VERSION_KEY)
const oldShards = await redis.get(SHARDS_KEY)
const pipeline = redis.pipeline()
for (const [manufacturer, shard] of shards) pipeline.hset(shardKey(version, manufacturer), shard)
await pipeline.exec()
const readBackPipeline = redis.pipeline()
for (const manufacturer of shards.keys()) readBackPipeline.hlen(shardKey(version, manufacturer))
const readBackCounts = await readBackPipeline.exec()
const readBackTotal = readBackCounts.reduce((total, count) => total + Number(count ?? 0), 0)
if (readBackTotal !== summary.uniqueSkuImages) throw new Error(`Redis read-back mismatch: ${readBackTotal} !== ${summary.uniqueSkuImages}`)

const switchVersion = redis.multi()
switchVersion.set(SHARDS_KEY, Array.from(shards.keys()))
switchVersion.set(VERSION_KEY, version)
switchVersion.del(BUILDING_VERSION_KEY)
switchVersion.del(REBUILD_LOCK_KEY)
switchVersion.del(DIRTY_KEY)
await switchVersion.exec()
switchedVersion = true

if (oldVersion !== null && oldVersion !== undefined && oldVersion !== version && Array.isArray(oldShards)) {
  const cleanup = redis.pipeline()
  for (const manufacturer of oldShards) cleanup.del(shardKey(oldVersion, String(manufacturer)))
  await cleanup.exec()
}
console.log(JSON.stringify({ activeVersion: version, readBackTotal, status: 'complete' }, null, 2))
} finally {
  if (redis && lockAcquired && !switchedVersion) {
    try {
      const currentLock = await redis.get(REBUILD_LOCK_KEY)
      if (currentLock === version) {
        const cleanupFailedRebuild = redis.multi()
        cleanupFailedRebuild.del(BUILDING_VERSION_KEY)
        cleanupFailedRebuild.del(REBUILD_LOCK_KEY)
        await cleanupFailedRebuild.exec()
      }
    } catch (cleanupError) {
      console.warn('[product-image-index] failed rebuild lock cleanup failed:', cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
  }
}
