/**
 * promotions-notion.ts
 * CRUD for 促銷活動 — campaign records linked to promotional DMs.
 * Status is computed from dates; no manual toggle needed.
 */

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB = process.env.NOTION_PROMOTIONS_DB!

// ── Helpers ───────────────────────────────────────────────────

function richText(content: string) {
  if (!content) return []
  return [{ text: { content: content.slice(0, 2000) } }]
}

function getText(page: any, field: string): string {
  const prop = page.properties?.[field]
  if (!prop) return ''
  const arr: any[] = prop.rich_text ?? prop.title ?? []
  return arr.map((b: any) => b.plain_text ?? '').join('')
}

function getSelect(page: any, field: string): string {
  return page.properties?.[field]?.select?.name ?? ''
}

function getDate(page: any, field: string): string {
  return page.properties?.[field]?.date?.start ?? ''
}

function getUrl(page: any, field: string): string {
  return page.properties?.[field]?.url ?? ''
}

function formatId(id: string): string {
  const clean = id.replace(/-/g, '')
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

// ── Types ─────────────────────────────────────────────────────

export type PromotionType   = '季度展場' | '月度促銷' | '課程' | '其他'
export type PromotionStatus = '規劃中' | '進行中' | '已結束'

export interface Promotion {
  id:          string
  name:        string
  type:        PromotionType | ''
  startDate:   string
  endDate:     string
  description: string
  dmUrl:       string
  status:      PromotionStatus
  createdTime: string
  campaignIds: string[]   // 關聯追蹤名單(可選,供業務準備↔執行互查)
}

export const PROMOTION_TYPES: PromotionType[] = ['季度展場', '月度促銷', '課程', '其他']

export const PROMOTION_STATUS_COLOR: Record<PromotionStatus, string> = {
  '進行中': 'bg-brand-50 text-green-700',
  '規劃中': 'bg-blue-100  text-blue-700',
  '已結束': 'bg-gray-100  text-gray-500',
}

// ── Status computation ────────────────────────────────────────

export function computeStatus(startDate: string, endDate: string): PromotionStatus {
  // Use Taiwan time (UTC+8)
  const twNow  = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const today  = twNow.toISOString().slice(0, 10)
  if (!startDate || today < startDate) return '規劃中'
  if (!endDate   || today <= endDate)  return '進行中'
  return '已結束'
}

// ── Parse ─────────────────────────────────────────────────────

function parsePage(page: any): Promotion {
  const startDate = getDate(page, '開始日期')
  const endDate   = getDate(page, '結束日期')
  return {
    id:          page.id.replace(/-/g, ''),
    name:        getText(page, '活動名稱'),
    type:        getSelect(page, '類型') as PromotionType | '',
    startDate,
    endDate,
    description: getText(page, '說明'),
    dmUrl:       getUrl(page, 'DM附件'),
    status:      computeStatus(startDate, endDate),
    createdTime: page.created_time ?? '',
    campaignIds: (page.properties?.['關聯追蹤名單']?.relation ?? []).map((r: any) => r.id),
  }
}

// ── Read ──────────────────────────────────────────────────────

export async function listPromotions(): Promise<Promotion[]> {
  const results: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notion.databases.query({
      database_id: DB,
      sorts: [{ property: '開始日期', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    results.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)
  return results.map(parsePage)
}

/** Only 進行中 + 規劃中 — for the order form dropdown */
export async function listActivePromotions(): Promise<Promotion[]> {
  const all = await listPromotions()
  return all.filter((p) => p.status !== '已結束')
}

export async function getPromotionById(id: string): Promise<Promotion | null> {
  try {
    const page: any = await notion.pages.retrieve({ page_id: formatId(id) })
    return parsePage(page)
  } catch {
    return null
  }
}

// ── Write ─────────────────────────────────────────────────────

export async function createPromotion(data: {
  name:         string
  type?:        string
  startDate?:   string
  endDate?:     string
  description?: string
  dmUrl?:       string
  campaignIds?: string[]
}): Promise<Promotion> {
  const props: any = {
    '活動名稱': { title: richText(data.name) },
  }
  if (data.type)                  props['類型']    = { select: { name: data.type } }
  if (data.startDate)             props['開始日期'] = { date: { start: data.startDate } }
  if (data.endDate)               props['結束日期'] = { date: { start: data.endDate } }
  if (data.description !== undefined) props['說明'] = { rich_text: richText(data.description) }
  if (data.dmUrl)                 props['DM附件']  = { url: data.dmUrl }
  if (data.campaignIds?.length)   props['關聯追蹤名單'] = { relation: data.campaignIds.map((id) => ({ id })) }

  const page: any = await notion.pages.create({
    parent: { database_id: DB },
    properties: props,
  })
  return parsePage(page)
}

export async function updatePromotion(id: string, data: {
  name?:        string
  type?:        string | null
  startDate?:   string | null
  endDate?:     string | null
  description?: string
  dmUrl?:       string | null
  campaignIds?: string[]
}): Promise<void> {
  const props: any = {}
  if (data.name        !== undefined) props['活動名稱'] = { title: richText(data.name ?? '') }
  if (data.type        !== undefined) props['類型']     = data.type ? { select: { name: data.type } } : { select: null }
  if (data.startDate   !== undefined) props['開始日期'] = data.startDate ? { date: { start: data.startDate } } : { date: null }
  if (data.endDate     !== undefined) props['結束日期'] = data.endDate   ? { date: { start: data.endDate   } } : { date: null }
  if (data.description !== undefined) props['說明']     = { rich_text: richText(data.description) }
  if (data.dmUrl       !== undefined) props['DM附件']   = data.dmUrl ? { url: data.dmUrl } : { url: null }
  if (data.campaignIds !== undefined) props['關聯追蹤名單'] = { relation: data.campaignIds.map((id) => ({ id })) }

  await notion.pages.update({ page_id: formatId(id), properties: props })
}

export async function archivePromotion(id: string): Promise<void> {
  await notion.pages.update({ page_id: formatId(id), archived: true })
}
