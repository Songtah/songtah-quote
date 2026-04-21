import { Client } from '@notionhq/client'
import type { NextRequest } from 'next/server'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const AUDIT_DB_TITLE = '系統操作紀錄'
const AUDIT_FALLBACK_SOURCE_DB = process.env.NOTION_VISITS_DB ?? '285dcdaafb2a80aea173db268665ae16'
const REDACTED = '[REDACTED]'

let auditDbIdCache: string | null = null

export type AuditActor = {
  id?: string
  name: string
  role?: string
}

export type AuditRequestContext = {
  method?: string
  path?: string
  ip?: string
  userAgent?: string
}

export type AuditEventInput = {
  module: string
  action: string
  entityType: string
  entityId: string
  entityTitle?: string
  summary: string
  actor: AuditActor
  request?: AuditRequestContext
  before?: unknown
  after?: unknown
  metadata?: unknown
}

export type AuditLogRow = {
  id: string
  occurredAt: string
  module: string
  action: string
  entityType: string
  entityId: string
  entityTitle: string
  summary: string
  actorName: string
  actorRole: string
  method: string
  path: string
  url: string
}

function normalizeDatabaseId(value?: string) {
  if (!value) return ''
  return value.replace('collection://', '')
}

function richText(content: string) {
  const safe = content.trim()
  if (!safe) return []

  const chunks = safe.match(/[\s\S]{1,1800}/g) ?? []
  return chunks.map((chunk) => ({
    type: 'text' as const,
    text: { content: chunk },
  }))
}

function isRateLimited(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; status?: number; body?: { code?: string } }
  return (
    maybeError.code === 'rate_limited' ||
    maybeError.status === 429 ||
    maybeError.body?.code === 'rate_limited'
  )
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function notionCallWithRetry<T>(
  label: string,
  action: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error

      if (!isRateLimited(error) || attempt === maxAttempts) {
        throw error
      }

      const delayMs = attempt * 1200
      console.warn(`${label} rate limited, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`)
      await sleep(delayMs)
    }
  }

  throw lastError
}

function sanitizeForAudit(value: unknown): unknown {
  if (value == null) return value

  if (Array.isArray(value)) {
    return value.map(sanitizeForAudit)
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        /password|token|secret/i.test(key) ? REDACTED : sanitizeForAudit(nested),
      ])
    )
  }

  if (typeof value === 'string') {
    return value.length > 4000 ? `${value.slice(0, 4000)}…` : value
  }

  return value
}

function formatAuditJson(value: unknown) {
  if (value == null) return ''

  try {
    return JSON.stringify(sanitizeForAudit(value), null, 2)
  } catch {
    return String(value)
  }
}

function toParagraphBlocks(label: string, content: string) {
  if (!content.trim()) return [] as any[]

  const sections = content.match(/[\s\S]{1,1800}/g) ?? []

  return sections.map((section, index) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richText(index === 0 ? `${label}\n${section}` : section),
    },
  }))
}

async function resolveAuditParentPageId() {
  const database: any = await notionCallWithRetry('audit.resolveSourceDb', () =>
    notion.databases.retrieve({
      database_id: normalizeDatabaseId(AUDIT_FALLBACK_SOURCE_DB),
    })
  )

  let parent = database.parent

  while (parent) {
    if (parent.type === 'page_id') return parent.page_id as string

    if (parent.type !== 'block_id') break

    const block: any = await notionCallWithRetry('audit.resolveParentBlock', () =>
      notion.blocks.retrieve({
        block_id: parent.block_id,
      })
    )

    parent = block.parent
  }

  return null
}

async function findExistingAuditDb(parentPageId?: string) {
  const response: any = await notionCallWithRetry('audit.searchDb', () =>
    notion.search({
      query: AUDIT_DB_TITLE,
      filter: { property: 'object', value: 'database' },
      page_size: 20,
    })
  )

  const results = response.results ?? []
  return results.find((result: any) => {
    const title =
      result.title?.map((item: any) => item.plain_text).join('') ??
      result.properties?.['事件標題']?.title?.map((item: any) => item.plain_text).join('') ??
      ''

    if (title !== AUDIT_DB_TITLE) return false
    if (!parentPageId) return true
    return result.parent?.type === 'page_id' && result.parent.page_id === parentPageId
  })
}

async function ensureAuditDb() {
  // 1. Explicit env var (fastest path)
  if (process.env.NOTION_AUDIT_LOGS_DB) {
    return normalizeDatabaseId(process.env.NOTION_AUDIT_LOGS_DB)
  }

  // 2. In-memory cache
  if (auditDbIdCache) return auditDbIdCache

  // 3. Search workspace by title — works even without knowing the parent page
  const existing = await findExistingAuditDb()
  if (existing?.id) {
    auditDbIdCache = normalizeDatabaseId(existing.id)
    return auditDbIdCache
  }

  // 4. DB not found → try to create it under the parent of the visits DB
  const parentPageId =
    process.env.NOTION_AUDIT_PARENT_PAGE_ID ??
    (await resolveAuditParentPageId())

  if (!parentPageId) {
    throw new Error('Cannot resolve Notion page for audit database')
  }

  const created: any = await notionCallWithRetry('audit.createDb', () =>
    notion.databases.create({
      parent: {
        type: 'page_id',
        page_id: parentPageId,
      },
      title: richText(AUDIT_DB_TITLE),
      properties: {
        事件標題: { title: {} },
        發生時間: { date: {} },
        模組: { rich_text: {} },
        操作: { rich_text: {} },
        實體類型: { rich_text: {} },
        實體ID: { rich_text: {} },
        實體名稱: { rich_text: {} },
        執行者: { rich_text: {} },
        角色: { rich_text: {} },
        摘要: { rich_text: {} },
        路徑: { rich_text: {} },
        請求方法: { rich_text: {} },
      } as any,
    })
  )

  auditDbIdCache = normalizeDatabaseId(created.id)
  return auditDbIdCache
}

export function getAuditActor(session: any): AuditActor {
  const user = session?.user as { id?: string; name?: string; role?: string } | undefined

  return {
    id: user?.id,
    name: user?.name ?? '未知使用者',
    role: user?.role ?? '',
  }
}

export function getAuditRequestContext(req: NextRequest): AuditRequestContext {
  const forwardedFor = req.headers.get('x-forwarded-for')
  const ip = forwardedFor?.split(',')[0]?.trim() ?? ''

  return {
    method: req.method,
    path: req.nextUrl.pathname,
    ip,
    userAgent: req.headers.get('user-agent') ?? '',
  }
}

export async function logAuditEvent(input: AuditEventInput) {
  const dbId = await ensureAuditDb()

  const beforeJson = formatAuditJson(input.before)
  const afterJson = formatAuditJson(input.after)
  const metadataJson = formatAuditJson(input.metadata)

  const children = [
    ...toParagraphBlocks('變更前', beforeJson),
    ...toParagraphBlocks('變更後', afterJson),
    ...toParagraphBlocks('補充資料', metadataJson),
    ...toParagraphBlocks('使用者代理', input.request?.userAgent ?? ''),
    ...toParagraphBlocks('IP', input.request?.ip ?? ''),
  ]

  await notionCallWithRetry('audit.createPage', () =>
    notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        事件標題: { title: richText(`${input.summary}`) },
        發生時間: { date: { start: new Date().toISOString() } },
        模組: { rich_text: richText(input.module) },
        操作: { rich_text: richText(input.action) },
        實體類型: { rich_text: richText(input.entityType) },
        實體ID: { rich_text: richText(input.entityId) },
        實體名稱: { rich_text: richText(input.entityTitle ?? '') },
        執行者: { rich_text: richText(input.actor.name) },
        角色: { rich_text: richText(input.actor.role ?? '') },
        摘要: { rich_text: richText(input.summary) },
        路徑: { rich_text: richText(input.request?.path ?? '') },
        請求方法: { rich_text: richText(input.request?.method ?? '') },
      } as any,
      ...(children.length > 0 ? { children } : {}),
    })
  )
}

function getPlainText(value: any) {
  if (!value) return ''
  if (value.type === 'title') return value.title?.map((item: any) => item.plain_text).join('') ?? ''
  if (value.type === 'rich_text') return value.rich_text?.map((item: any) => item.plain_text).join('') ?? ''
  if (value.type === 'date') return value.date?.start ?? ''
  return ''
}

export async function listAuditLogs(limit = 100): Promise<AuditLogRow[]> {
  const dbId = await ensureAuditDb()

  const response: any = await notionCallWithRetry('audit.listLogs', () =>
    notion.databases.query({
      database_id: dbId,
      page_size: limit,
      sorts: [{ property: '發生時間', direction: 'descending' }],
    })
  )

  return (response.results ?? []).map((page: any) => ({
    id: page.id,
    occurredAt: getPlainText(page.properties?.['發生時間']),
    module: getPlainText(page.properties?.['模組']),
    action: getPlainText(page.properties?.['操作']),
    entityType: getPlainText(page.properties?.['實體類型']),
    entityId: getPlainText(page.properties?.['實體ID']),
    entityTitle: getPlainText(page.properties?.['實體名稱']),
    summary: getPlainText(page.properties?.['摘要']),
    actorName: getPlainText(page.properties?.['執行者']),
    actorRole: getPlainText(page.properties?.['角色']),
    method: getPlainText(page.properties?.['請求方法']),
    path: getPlainText(page.properties?.['路徑']),
    url: page.url ?? '',
  }))
}
