/**
 * lib/visit-reaction-rerun.ts —— 用新判讀（lib/visit-reaction-ai.ts）重跑全部客情的「客戶反應」與「聯絡人」
 *
 * 流程（每一步由中央管理在 /api/admin/visit-reactions 觸發）：
 *   1. createRerunBatch：把所有有內容的客情送進 Anthropic Message Batches（半價、不受函式時限影響）
 *   2. rerunStatus：查批次進度
 *   3. rerunReport：批次完成後產出差異報表（舊標籤 → 新標籤的筆數與抽樣），不寫入
 *   4. applyRerun：核可後分段寫入（offset/limit），每筆改前的值存進還原紀錄；undoRerun 可整批還原
 * 寫入規則：「客戶反應」以新判讀為準（含改成留白）；「聯絡人」只補原本空白的，不覆蓋。判讀失敗的不動。
 */
import { scanVisitPages } from '@/lib/notion/visits'
import { notion, notionCallWithRetry, getRedis, getText, getTitle, getSelect, getDate, richText } from '@/lib/notion/shared'
import { reactionRequestParams, parseReactionMessage, getReactionClient, type ReactionResult } from '@/lib/visit-reaction-ai'

const STATE_KEY = 'visit-reaction-rerun:state'
const UNDO_KEY = 'visit-reaction-rerun:undo'      // hash：客情 id → { r: 原客戶反應, c: 原聯絡人 }

type VisitRow = { id: string; date: string; name: string; sp: string; text: string; old: string; oldContact: string }
export type RerunRow = VisitRow & { result: ReactionResult | null }
type State = { batchId: string; createdAt: string; count: number }

const key = (id: string) => id.replace(/-/g, '')

async function loadVisits(): Promise<Map<string, VisitRow>> {
  const map = new Map<string, VisitRow>()
  for await (const p of scanVisitPages('visit-reaction-rerun')) {
    const text = getText(p, '拜訪內容').trim()
    if (!text) continue
    map.set(key(p.id), {
      id: p.id, date: getDate(p, '日期'), name: getTitle(p, '單位名稱'),
      sp: getSelect(p, '業務人員') || getText(p, '業務人員'), text,
      old: getSelect(p, '客戶反應'), oldContact: getText(p, '聯絡人').trim(),
    })
  }
  return map
}

function client() {
  const c = getReactionClient()
  if (!c) throw new Error('尚未設定 ANTHROPIC_API_KEY')
  return c
}

async function getState(): Promise<State | null> {
  const r = getRedis()
  return r ? ((await r.get<State>(STATE_KEY)) ?? null) : null
}

/** 1. 建立批次（會產生 API 費用；同一時間只允許一個進行中的批次） */
export async function createRerunBatch(): Promise<State> {
  const r = getRedis()
  if (!r) throw new Error('Redis 未設定')
  const prev = await getState()
  if (prev) {
    const b = await client().messages.batches.retrieve(prev.batchId)
    if (b.processing_status !== 'ended') throw new Error(`已有進行中的批次 ${prev.batchId}`)
  }
  const visits = await loadVisits()
  const requests = Array.from(visits.values()).map((v) => ({ custom_id: key(v.id), params: reactionRequestParams(v.text) as any }))
  const batch = await client().messages.batches.create({ requests })
  const state: State = { batchId: batch.id, createdAt: new Date().toISOString(), count: requests.length }
  await r.set(STATE_KEY, state)
  return state
}

/** 2. 批次進度 */
export async function rerunStatus() {
  const s = await getState()
  if (!s) return { state: null }
  const b = await client().messages.batches.retrieve(s.batchId)
  return { state: s, status: b.processing_status, counts: b.request_counts }
}

/** 批次結果逐筆配上原始客情（依客情 id 排序，分段寫入時位置固定） */
async function rerunRows(): Promise<RerunRow[]> {
  const s = await getState()
  if (!s) throw new Error('尚未建立批次')
  const b = await client().messages.batches.retrieve(s.batchId)
  if (b.processing_status !== 'ended') throw new Error(`批次尚未完成（${b.processing_status}）`)
  const visits = await loadVisits()
  const results = new Map<string, ReactionResult | null>()
  for await (const item of await client().messages.batches.results(s.batchId)) {
    const v = visits.get(item.custom_id)
    if (!v) continue
    results.set(item.custom_id, item.result.type === 'succeeded' ? parseReactionMessage(v.text, item.result.message as any) : null)
  }
  return Array.from(visits.entries())
    .filter(([k]) => results.has(k))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ ...v, result: results.get(k) ?? null }))
}

const changeOf = (row: RerunRow) => {
  if (!row.result) return { reaction: false, contact: false }
  return {
    reaction: (row.result.reaction || '') !== (row.old || ''),
    contact: Boolean(row.result.contact) && !row.oldContact,
  }
}

/** 3. 差異報表（不寫入）：舊 → 新的筆數、每種變化抽樣、聯絡人可補幾筆 */
export async function rerunReport() {
  const rows = await rerunRows()
  const matrix: Record<string, number> = {}
  const samples: Record<string, { name: string; date: string; evidence: string; text: string }[]> = {}
  const before: Record<string, number> = {}
  const after: Record<string, number> = {}
  let failed = 0, reactionChanges = 0, contactFills = 0
  for (const row of rows) {
    before[row.old || '(空)'] = (before[row.old || '(空)'] ?? 0) + 1
    if (!row.result) { failed++; continue }
    const nw = row.result.reaction || '(空)'
    after[nw] = (after[nw] ?? 0) + 1
    const ch = changeOf(row)
    if (ch.contact) contactFills++
    if (!ch.reaction) continue
    reactionChanges++
    const k = `${row.old || '(空)'} → ${nw}`
    matrix[k] = (matrix[k] ?? 0) + 1
    const list = (samples[k] ??= [])
    if (list.length < 3) list.push({ name: row.name, date: row.date, evidence: row.result.evidence, text: row.text.slice(0, 120) })
  }
  return {
    total: rows.length, failed, reactionChanges, contactFills, before, after,
    matrix: Object.fromEntries(Object.entries(matrix).sort((a, b) => b[1] - a[1])),
    samples,
  }
}

/** 差異明細 CSV（核可前給人逐筆看；只列有變動者） */
export async function rerunCsv(): Promise<string> {
  const rows = await rerunRows()
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
  const lines = ['日期,單位名稱,業務,原客戶反應,新客戶反應,判讀依據,原聯絡人,新聯絡人,拜訪內容']
  for (const row of rows) {
    const ch = changeOf(row)
    if (!ch.reaction && !ch.contact) continue
    lines.push([row.date, row.name, row.sp, row.old, row.result!.reaction, row.result!.evidence, row.oldContact, ch.contact ? row.result!.contact : '', row.text].map(esc).join(','))
  }
  return '﻿' + lines.join('\n')
}

/** 4. 分段寫入；改前的值存進還原紀錄（已存過的不覆蓋，確保還原到最初的值） */
export async function applyRerun(options: { offset: number; limit: number }) {
  const r = getRedis()
  if (!r) throw new Error('Redis 未設定')
  const rows = await rerunRows()
  const slice = rows.slice(options.offset, options.offset + options.limit)
  let reactions = 0, contacts = 0, failed = 0
  for (const row of slice) {
    const ch = changeOf(row)
    if (!ch.reaction && !ch.contact) continue
    try {
      await r.hsetnx(UNDO_KEY, key(row.id), { r: row.old || '', c: row.oldContact || '' })
      const props: Record<string, any> = {}
      if (ch.reaction) props['客戶反應'] = { select: row.result!.reaction ? { name: row.result!.reaction } : null }
      if (ch.contact) props['聯絡人'] = { rich_text: richText(row.result!.contact) }
      await notionCallWithRetry('visit-reaction-rerun:apply', () => notion.pages.update({ page_id: row.id, properties: props as any }))
      if (ch.reaction) reactions++
      if (ch.contact) contacts++
    } catch (e) {
      failed++
      console.warn('[visit-reaction-rerun] 寫入失敗', row.id, (e as Error)?.message)
    }
  }
  return { total: rows.length, offset: options.offset, processed: slice.length, reactions, contacts, failed, nextOffset: options.offset + slice.length }
}

/** 整批還原（分段）：把還原紀錄裡的原值寫回 */
export async function undoRerun(options: { limit: number }) {
  const r = getRedis()
  if (!r) throw new Error('Redis 未設定')
  const all = ((await r.hgetall<Record<string, { r: string; c: string }>>(UNDO_KEY)) ?? {}) as Record<string, { r: string; c: string }>
  const entries = Object.entries(all).slice(0, options.limit)
  let restored = 0
  for (const [id, prev] of entries) {
    await notionCallWithRetry('visit-reaction-rerun:undo', () => notion.pages.update({
      page_id: id,
      properties: {
        '客戶反應': { select: prev.r ? { name: prev.r } : null },
        '聯絡人': { rich_text: prev.c ? richText(prev.c) : [] },
      } as any,
    }))
    await r.hdel(UNDO_KEY, id)
    restored++
  }
  return { restored, remaining: Object.keys(all).length - restored }
}
