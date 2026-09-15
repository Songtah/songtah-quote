/**
 * lib/event-import-server.ts —— 歷史活動紀錄匯入：伺服器端驗證、重複判斷與預覽（組合層）
 *
 * 從 /api/events/import 抽出，讓預覽邏輯可以獨立驗證；route 只負責授權與分派動作。
 */
import {
  listAllEvents, listEventRegistrations, type EventItem, type EventRegistration,
} from '@/lib/notion/events'
import { createCustomerResolver } from '@/lib/registration-footprint'
import { customerNameStem } from '@/lib/customer-name-match'
import {
  eventKey, parseLooseDate, parseArea, normalizeCity, statusForDate, IMPORT_MAX_ROWS, EVENT_TYPES, type ImportRow,
} from '@/lib/event-import'

const phoneTail = (s: string) => (s ?? '').replace(/\D/g, '').slice(-8)

/** 伺服器端重新驗證前端送來的列（不信任前端解析結果） */
export function sanitizeImportRows(input: unknown): ImportRow[] {
  if (!Array.isArray(input)) return []
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const out: ImportRow[] = []
  for (const r of input.slice(0, IMPORT_MAX_ROWS) as any[]) {
    const eventDate = parseLooseDate(str(r?.eventDate, 20))
    // 區域在伺服器端重算：有地址以地址為準，否則只接受格式正確的縣市＋行政區
    const address = str(r?.address, 200)
    const fromAddress = parseArea(address)
    const city = fromAddress.city || normalizeCity(str(r?.city, 10))
    const districtRaw = str(r?.district, 6)
    const district = fromAddress.city ? fromAddress.district : (city && /^.{1,4}[區鄉鎮市]$/.test(districtRaw) ? districtRaw : '')
    const row: ImportRow = {
      eventName: str(r?.eventName, 200),
      eventDate,
      eventType: (EVENT_TYPES as readonly string[]).includes(r?.eventType) ? r.eventType : '培訓',
      institution: str(r?.institution, 100),
      contact: str(r?.contact, 50),
      phone: str(r?.phone, 30),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(r?.email, 100)) ? str(r?.email, 100) : '',
      city, district, address,
      status: statusForDate(['已到場', '已報名', '已確認', '取消'].includes(r?.status) ? r.status : '已報名', eventDate),
      attendees: Math.min(Math.max(Number(r?.attendees) || 1, 1), 100),
      note: str(r?.note, 200),
    }
    if (row.eventName && row.eventDate && row.institution.length >= 2) out.push(row)
  }
  return out
}

/** 同一場活動內視為重複：電話末 8 碼＋姓名相同，或（無電話時）機構字根＋姓名相同 */
export function registrationDupKey(r: { institution: string; contact: string; phone: string }): string {
  const tail = phoneTail(r.phone)
  if (tail.length === 8) return `p:${tail}|${r.contact.replace(/\s/g, '')}`
  return `n:${customerNameStem(r.institution)}|${r.contact.replace(/\s/g, '')}`
}

export function findEventByNameDate(events: EventItem[], name: string, date: string): EventItem | undefined {
  const key = eventKey(name, date)
  return events.find((e) => eventKey(e.name, (e.date ?? '').slice(0, 10)) === key)
}

export async function existingDupKeys(eventId: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
  let set = cache.get(eventId)
  if (!set) {
    const regs: EventRegistration[] = await listEventRegistrations(eventId)
    set = new Set(regs.map(registrationDupKey))
    cache.set(eventId, set)
  }
  return set
}

export type ImportPreview = {
  rows: number
  counts: { toImport: number; duplicate: number; matched: number; created: number; unmatched: number; cancelled: number }
  events: { name: string; date: string; type: string; existingId: string; rows: number; duplicates: number }[]
  newCustomers: { code: string; name: string; area: string; assignTo: string }[]
  details: { index: number; eventName: string; institution: string; contact: string; area: string; result: string; note: string }[]
}

/** 預覽：不寫入任何資料。客戶解析用 dryRun 解析器，與實際匯入後的自動配對同一套規則。 */
export async function buildImportPreview(rows: ImportRow[]): Promise<ImportPreview> {
  const events = await listAllEvents()
  const dupCache = new Map<string, Set<string>>()
  const seen = new Map<string, Set<string>>()   // 檔案內重複
  const eventSummary = new Map<string, ImportPreview['events'][number]>()
  const resolve = createCustomerResolver({ dryRun: true, maxCreates: Infinity })
  const resolvedByInstitution = new Map<string, Awaited<ReturnType<typeof resolve>>>()
  const counts: ImportPreview['counts'] = { toImport: 0, duplicate: 0, matched: 0, created: 0, unmatched: 0, cancelled: 0 }
  const details: ImportPreview['details'] = []
  const newCustomers: ImportPreview['newCustomers'] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const key = eventKey(r.eventName, r.eventDate)
    const existing = findEventByNameDate(events, r.eventName, r.eventDate)
    const summary = eventSummary.get(key) ?? { name: r.eventName, date: r.eventDate, type: r.eventType, existingId: existing?.id ?? '', rows: 0, duplicates: 0 }
    eventSummary.set(key, summary)
    const base = { index: i, eventName: r.eventName, institution: r.institution, contact: r.contact, area: `${r.city}${r.district}` }

    const dk = registrationDupKey(r)
    const inFile = seen.get(key) ?? new Set<string>()
    seen.set(key, inFile)
    const inDb = existing ? await existingDupKeys(existing.id, dupCache) : new Set<string>()
    if (inFile.has(dk) || inDb.has(dk)) {
      counts.duplicate++; summary.duplicates++
      details.push({ ...base, result: '重複略過', note: inDb.has(dk) ? '系統已有這筆紀錄' : '檔案內重複' })
      continue
    }
    inFile.add(dk)
    counts.toImport++; summary.rows++

    // 取消的紀錄只留存，不配對（與排程一致）
    if (r.status === '取消') {
      counts.cancelled++
      details.push({ ...base, result: '匯入（取消／未出席，不配對）', note: '' })
      continue
    }
    // 同機構（字根＋縣市＋電話）只解析一次
    const instKey = `${customerNameStem(r.institution)}|${r.city}|${r.district}|${phoneTail(r.phone)}`
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
      ...base,
      result: res.outcome === 'matched' ? '配對既有客戶' : res.outcome === 'created' ? '新建客戶' : '不配對',
      note: res.note,
    })
  }

  return {
    rows: rows.length,
    counts,
    events: Array.from(eventSummary.values()).sort((a, b) => a.date.localeCompare(b.date)),
    newCustomers,
    details: details.slice(0, 500),
  }
}
