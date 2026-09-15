/**
 * POST /api/events/import —— 歷史活動參與紀錄匯入（活動管理 → 匯入歷史紀錄）
 *
 * 寫入主檔前一律先預覽（CLAUDE.md：寫入前先 dry-run），分四步，前端依序呼叫：
 *   preview       不寫任何東西。回報會新建幾場活動、匯入幾筆、重複／無效幾筆、客戶會怎麼配對或建檔。
 *   create-events 建立檔案中尚不存在的活動（已過＝已結束，今天以後＝開放報名）。冪等：同名同日已存在就沿用。
 *   import-rows   分批（每批 ≤40）寫入報名紀錄，來源＝歷史匯入。每批寫入前重新比對重複，重送不會重複建。
 *   process       對剛匯入的紀錄跑自動配對（與每小時排程同一套 processRegistrations），
 *                 單次建檔上限 15 家，deferred>0 時前端再呼叫一次直到處理完。
 *
 * 客戶配對與建檔規則完全沿用 lib/registration-footprint（名稱＋縣市＋電話；查無才以 BAS 唯一相符建檔）。
 * 預覽、驗證與重複判斷在 lib/event-import-server.ts。
 * 匯入的是過去紀錄：足跡日期取活動日，超過 60 天不會變成拜訪建議，只留在客戶頁的活動足跡。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listAllEvents, createEvent, createRegistration } from '@/lib/notion/events'
import { processRegistrations } from '@/lib/registration-footprint'
import { eventKey, parseLooseDate, todayTW, IMPORT_MAX_ROWS, EVENT_TYPES } from '@/lib/event-import'
import {
  sanitizeImportRows, registrationDupKey, findEventByNameDate, existingDupKeys, buildImportPreview,
} from '@/lib/event-import-server'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: '資料格式錯誤' }, { status: 400 }) }
  const action = body?.action

  try {
    // ── preview：不寫入 ───────────────────────────────────────
    if (action === 'preview') {
      const rows = sanitizeImportRows(body.rows)
      if (!rows.length) return NextResponse.json({ error: '沒有可匯入的有效資料' }, { status: 400 })
      return NextResponse.json(await buildImportPreview(rows))
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
        const existing = findEventByNameDate(events, name, date)
        if (existing) { ids[key] = existing.id; continue }
        const ev = await createEvent({
          // 名單裡可能有還沒辦的課（已先收報名），不能一律標已結束
          name, date, location: '', status: date >= todayTW() ? '開放報名' : '已結束',
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
      const rows = sanitizeImportRows(body.rows).slice(0, 40)
      const eventIds: Record<string, string> = body.eventIds && typeof body.eventIds === 'object' ? body.eventIds : {}
      const dupCache = new Map<string, Set<string>>()
      const createdIds: string[] = []
      let skipped = 0
      for (const r of rows) {
        const eventId = eventIds[eventKey(r.eventName, r.eventDate)]
        if (!eventId || typeof eventId !== 'string') { skipped++; continue }
        const keys = await existingDupKeys(eventId, dupCache)
        const dk = registrationDupKey(r)
        if (keys.has(dk)) { skipped++; continue }
        const reg = await createRegistration({
          eventId, institution: r.institution, contact: r.contact, phone: r.phone, email: r.email,
          city: r.city, district: r.district, address: r.address,
          attendees: r.attendees, status: r.status, source: '歷史匯入',
          note: r.note ? `職稱／備註：${r.note}` : undefined,
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
