/**
 * POST /api/events/import —— 歷史活動參與紀錄匯入（活動管理 → 匯入歷史紀錄）
 *
 * 寫入主檔前一律先預覽（CLAUDE.md：寫入前先 dry-run），分四步，前端依序呼叫：
 *   preview       不寫任何東西。回報會新建幾場活動、匯入幾筆、重複／無效幾筆、客戶會怎麼配對或建檔。
 *   create-events 建立檔案中尚不存在的活動（狀態＝已結束）。冪等：同名同日已存在就沿用。
 *   import-rows   分批（每批 ≤40）寫入報名紀錄，來源＝歷史匯入。每批寫入前重新比對重複，重送不會重複建。
 *   process       對剛匯入的紀錄跑自動配對（與每小時排程同一套 processRegistrations），
 *                 單次建檔上限 15 家，deferred>0 時前端再呼叫一次直到處理完。
 *
 * 客戶配對與建檔規則完全沿用 lib/registration-footprint（名稱＋縣市＋電話；查無才以 BAS 唯一相符建檔）。
 * 匯入的是過去紀錄：足跡日期取活動日，超過 60 天不會變成拜訪建議，只留在客戶頁的活動足跡。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  listAllEvents, createEvent, createRegistration, listEventRegistrations,
  type EventItem, type EventRegistration,
} from '@/lib/notion/events'
import { createCustomerResolver, processRegistrations } from '@/lib/registration-footprint'
import { customerNameStem } from '@/lib/customer-name-match'
import { eventKey, parseLooseDate, IMPORT_MAX_ROWS, EVENT_TYPES, type ImportRow } from '@/lib/event-import'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const phoneTail = (s: string) => (s ?? '').replace(/\D/g, '').slice(-8)

/** 伺服器端重新驗證前端送來的列（不信任前端解析結果） */
function sanitizeRows(input: unknown): ImportRow[] {
  if (!Array.isArray(input)) return []
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const out: ImportRow[] = []
  for (const r of input.slice(0, IMPORT_MAX_ROWS) as any[]) {
    const eventDate = parseLooseDate(str(r?.eventDate, 20))
    const row: ImportRow = {
      eventName: str(r?.eventName, 200),
      eventDate,
      eventType: (EVENT_TYPES as readonly string[]).includes(r?.eventType) ? r.eventType : '培訓',
      institution: str(r?.institution, 100),
      contact: str(r?.contact, 50),
      phone: str(r?.phone, 30),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r?.email, 100)) ? str(r?.email, 100) : '',
      city: str(r?.city, 10),
      status: ['已到場', '已報名', '已確認', '取消'].includes(r?.status) ? r.status : '已到場',
      attendees: Math.min(Math.max(Number(r?.attendees) || 1, 1), 100),
    }
    if (row.eventName && row.eventDate && row.institution.length >= 2) out.push(row)
  }
  return out
}

/** 同一場活動內視為重複：電話末 8 碼相同，或（無電話時）機構字根＋聯絡人相同 */
function dupKey(r: { institution: string; contact: string; phone: string }): string {
  const tail = phoneTail(r.phone)
  if (tail.length === 8) return `p:${tail}|${r.contact.replace(/\s/g, '')}`
  return `n:${customerNameStem(r.institution)}|${r.contact.replace(/\s/g, '')}`
}

function findEvent(events: EventItem[], name: string, date: string): EventItem | undefined {
  const key = eventKey(name, date)
  return events.find((e) => eventKey(e.name, (e.date ?? '').slice(0, 10)) === key)
}

async function existingDupKeys(eventId: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
  let set = cache.get(eventId)
  if (!set) {
    const regs: EventRegistration[] = await listEventRegistrations(eventId)
    set = new Set(regs.map(dupKey))
    cache.set(eventId, set)
  }
  return set
}

export const POST = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: '資料格式錯誤' }, { status: 400 }) }
  const action = body?.action

  try {
    // ── preview：不寫入 ───────────────────────────────────────
    if (action === 'preview') {
      const rows = sanitizeRows(body.rows)
      if (!rows.length) return NextResponse.json({ error: '沒有可匯入的有效資料' }, { status: 400 })

      const events = await listAllEvents()
      const dupCache = new Map<string, Set<string>>()
      const seen = new Map<string, Set<string>>()   // 檔案內重複
      const eventSummary = new Map<string, { name: string; date: string; type: string; existingId: string; rows: number; duplicates: number }>()
      const resolve = createCustomerResolver({ dryRun: true, maxCreates: Infinity })
      const resolvedByInstitution = new Map<string, Awaited<ReturnType<typeof resolve>>>()
      const counts = { toImport: 0, duplicate: 0, matched: 0, created: 0, unmatched: 0, cancelled: 0 }
      const details: { index: number; eventName: string; institution: string; contact: string; result: string; note: string }[] = []
      const newCustomers: { name: string; area: string; assignTo: string }[] = []

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const key = eventKey(r.eventName, r.eventDate)
        const existing = findEvent(events, r.eventName, r.eventDate)
        const summary = eventSummary.get(key) ?? { name: r.eventName, date: r.eventDate, type: r.eventType, existingId: existing?.id ?? '', rows: 0, duplicates: 0 }
        eventSummary.set(key, summary)

        const dk = dupKey(r)
        const inFile = seen.get(key) ?? new Set<string>()
        seen.set(key, inFile)
        const inDb = existing ? await existingDupKeys(existing.id, dupCache) : new Set<string>()
        if (inFile.has(dk) || inDb.has(dk)) {
          counts.duplicate++; summary.duplicates++
          details.push({ index: i, eventName: r.eventName, institution: r.institution, contact: r.contact, result: '重複略過', note: inDb.has(dk) ? '系統已有這筆紀錄' : '檔案內重複' })
          continue
        }
        inFile.add(dk)
        counts.toImport++; summary.rows++
        if (r.status === '取消') { counts.cancelled++ }

        // 同機構（名稱＋縣市）只解析一次；取消的紀錄不配對（與排程一致）
        if (r.status === '取消') {
          details.push({ index: i, eventName: r.eventName, institution: r.institution, contact: r.contact, result: '匯入（取消／未出席，不配對）', note: '' })
          continue
        }
        const instKey = `${customerNameStem(r.institution)}|${r.city}|${phoneTail(r.phone)}`
        let res = resolvedByInstitution.get(instKey)
        if (!res) {
          res = await resolve(r)
          resolvedByInstitution.set(instKey, res)
          if (res.outcome === 'created' && res.create) newCustomers.push(res.create)
        }
        // counts.created＝配到「本次會新建的客戶」的紀錄筆數；實際新建家數看 newCustomers（同一家多筆只建一次）
        if (res.outcome === 'matched') counts.matched++
        else if (res.outcome === 'created') counts.created++
        else counts.unmatched++
        details.push({
          index: i, eventName: r.eventName, institution: r.institution, contact: r.contact,
          result: res.outcome === 'matched' ? '配對既有客戶' : res.outcome === 'created' ? '新建客戶' : '不配對',
          note: res.note,
        })
      }

      return NextResponse.json({
        rows: rows.length,
        counts,
        events: Array.from(eventSummary.values()).sort((a, b) => a.date.localeCompare(b.date)),
        newCustomers,
        details: details.slice(0, 500),
      })
    }

    // ── create-events：建立缺少的活動 ─────────────────────────────
    if (action === 'create-events') {
      const wanted = Array.isArray(body.events) ? body.events.slice(0, 500) : []
      const events = await listAllEvents()
      const ids: Record<string, string> = {}
      let created = 0
      for (const e of wanted as any[]) {
        const name = typeof e?.name === 'string' ? e.name.trim().slice(0, 200) : ''
        const date = parseLooseDate(typeof e?.date === 'string' ? e.date : '')
        if (!name || !date) continue
        const key = eventKey(name, date)
        if (ids[key]) continue
        const existing = findEvent(events, name, date)
        if (existing) { ids[key] = existing.id; continue }
        const ev = await createEvent({
          name, date, location: '', status: '已結束',
          type: (EVENT_TYPES as readonly string[]).includes(e?.type) ? e.type : '培訓',
          description: '由歷史紀錄匯入建立',
        })
        events.push(ev)
        ids[key] = ev.id
        created++
      }
      if (created) {
        logAuditEvent({
          module: 'events', action: 'create', entityType: 'event', entityId: '', entityTitle: `歷史匯入 ${created} 場活動`,
          summary: `歷史紀錄匯入：新建 ${created} 場活動`, actor: getAuditActor(session), request: getAuditRequestContext(req),
          after: { events: Object.keys(ids) },
        }).catch(() => {})
      }
      return NextResponse.json({ ids, created })
    }

    // ── import-rows：分批寫入報名紀錄 ─────────────────────────────
    if (action === 'import-rows') {
      const rows = sanitizeRows(body.rows).slice(0, 40)
      const eventIds: Record<string, string> = body.eventIds && typeof body.eventIds === 'object' ? body.eventIds : {}
      const dupCache = new Map<string, Set<string>>()
      const createdIds: string[] = []
      let skipped = 0
      for (const r of rows) {
        const eventId = eventIds[eventKey(r.eventName, r.eventDate)]
        if (!eventId || typeof eventId !== 'string') { skipped++; continue }
        const keys = await existingDupKeys(eventId, dupCache)
        const dk = dupKey(r)
        if (keys.has(dk)) { skipped++; continue }
        const reg = await createRegistration({
          eventId, institution: r.institution, contact: r.contact, phone: r.phone, email: r.email,
          city: r.city, attendees: r.attendees, status: r.status, source: '歷史匯入',
        })
        keys.add(dk)
        createdIds.push(reg.id)
      }
      return NextResponse.json({ createdIds, skipped })
    }

    // ── process：自動配對剛匯入的紀錄 ─────────────────────────────
    if (action === 'process') {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string').slice(0, IMPORT_MAX_ROWS) : []
      if (!ids.length) return NextResponse.json({ error: '沒有要處理的紀錄' }, { status: 400 })
      const result = await processRegistrations({ onlyIds: ids, maxCreates: 15 })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: '未知的動作' }, { status: 400 })
  } catch (error: any) {
    console.error('events import error:', error)
    return NextResponse.json({ error: error?.message ?? '匯入失敗' }, { status: 500 })
  }
})
