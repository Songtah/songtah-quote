/**
 * lib/db/notion-store.ts — 以 Supabase 模擬 Notion API 的資料庫／頁面介面。
 *
 * 用途：小型 Notion 資料庫（活動、報名、轄區、名單、積分、跨區、促銷、辦課、素材、訂單、報價、帳號…）
 * 整庫搬進 notion_pages 後，`lib/notion/shared.ts` 的 notion client 代理會把對這些庫的呼叫導到這裡，
 * 既有程式（getTitle/getSelect… 與 Notion filter 寫法）完全不用改。
 *
 * 支援：databases.query（and/or、title/rich_text/select/status/multi_select/date/checkbox/number/relation/
 * url/phone_number/email/people/unique_id/formula 常用運算子、created_time/last_edited_time、sorts、分頁）、
 * databases.retrieve／update（schema 快照）、pages.create／retrieve／update（含 archived）。
 * 不支援：rollup／formula 重算（保留搬遷時的值）、blocks。
 */
import { randomUUID } from 'crypto'
import { sql } from './client'

const bare = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
const dashed = (id: string) => { const b = bare(id); return b.length === 32 ? `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}` : id }

// ── 哪些庫已搬進來（快取 60 秒）──────────────────────────────────────────
let storedDbs: Set<string> | null = null
let storedAt = 0
export async function storedDbIds(): Promise<Set<string>> {
  if (storedDbs && Date.now() - storedAt < 60_000) return storedDbs
  try {
    const rows = await sql()`select db_id from notion_databases`
    storedDbs = new Set(rows.map((r: any) => r.db_id)); storedAt = Date.now()
  } catch { storedDbs = storedDbs ?? new Set() }
  return storedDbs
}
export async function isStoredDb(id: string): Promise<boolean> { return (await storedDbIds()).has(bare(id)) }
export async function isStoredPage(id: string): Promise<boolean> {
  if (!(await storedDbIds()).size) return false
  const r = await sql()`select 1 from notion_pages where page_id = ${bare(id)}`
  return r.length > 0
}

// ── 寫入形狀 → 讀取形狀 ─────────────────────────────────────────────────
const ANN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
function richOut(arr: any): any[] {
  if (!Array.isArray(arr)) return []
  return arr.map((t) => {
    if (t?.plain_text !== undefined && t?.type) return t                // 已是讀取形狀
    const content = t?.text?.content ?? t?.plain_text ?? ''
    return { type: 'text', text: { content, link: t?.text?.link ?? null }, annotations: { ...ANN }, plain_text: content, href: t?.text?.link?.url ?? null }
  })
}
function optOut(o: any) { return o == null ? null : { id: o.id ?? o.name, name: o.name, color: o.color ?? 'default' } }
function toReadProp(type: string, input: any): any {
  const v = input?.[type]
  switch (type) {
    case 'title': case 'rich_text': return { type, [type]: richOut(v) }
    case 'select': case 'status': return { type, [type]: optOut(v) }
    case 'multi_select': return { type, multi_select: (v ?? []).map(optOut) }
    case 'date': return { type, date: v ? { start: v.start, end: v.end ?? null, time_zone: v.time_zone ?? null } : null }
    case 'relation': return { type, relation: (v ?? []).map((r: any) => ({ id: dashed(r.id) })), has_more: false }
    case 'people': return { type, people: (v ?? []).map((p: any) => (p.object ? p : { object: 'user', id: p.id })) }
    default: return { type, [type]: v === undefined ? null : v }   // checkbox/number/url/phone_number/email/files/unique_id…
  }
}
/** 依 schema 正規化寫入的 properties；未知欄位依傳入的型別鍵判斷 */
function normalizeWrite(schema: Record<string, any>, props: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [name, input] of Object.entries(props ?? {})) {
    const type = schema[name]?.type ?? Object.keys(input ?? {}).find((k) => k !== 'id' && k !== 'type') ?? 'rich_text'
    out[name] = { id: schema[name]?.id ?? name, ...toReadProp(type, input) }
    // 新的 select／status／multi_select 選項補進 schema，讓 databases.retrieve 的選項清單跟上
    if (['select', 'status', 'multi_select'].includes(type) && schema[name]) {
      const opts: any[] = schema[name][type]?.options ?? (schema[name][type] = { options: [] }).options
      const names = type === 'multi_select' ? (out[name].multi_select as any[]).map((o) => o.name) : out[name][type] ? [out[name][type].name] : []
      for (const n of names) if (!opts.some((o) => o.name === n)) opts.push({ id: n, name: n, color: 'default' })
    }
  }
  return out
}

// ── 讀取輔助 ─────────────────────────────────────────────────────────────
const plain = (p: any) => (Array.isArray(p?.[p?.type]) ? p[p.type].map((t: any) => t.plain_text ?? t?.text?.content ?? '').join('') : '')
function propValue(page: any, prop: string) {
  if (prop === 'created_time' || prop === 'last_edited_time') return page[prop]
  return page.properties?.[prop]
}
function matchFilter(page: any, f: any): boolean {
  if (!f) return true
  if (f.and) return f.and.every((x: any) => matchFilter(page, x))
  if (f.or) return f.or.some((x: any) => matchFilter(page, x))
  if (f.timestamp) { const v = page[f.timestamp] as string; return cmpDate(v, f[f.timestamp]) }
  const p = page.properties?.[f.property]
  const kind = Object.keys(f).find((k) => !['property', 'type'].includes(k))!
  const cond = f[kind]
  if (!p) return !!(cond?.is_empty)
  switch (kind) {
    case 'title': case 'rich_text': case 'url': case 'phone_number': case 'email': {
      const v = kind === 'title' || kind === 'rich_text' ? plain(p) : (p[p.type] ?? '')
      return cmpText(String(v ?? ''), cond)
    }
    case 'select': case 'status': { const v = p[p.type]?.name ?? ''; return cmpText(v, cond, true) }
    case 'multi_select': { const names = (p.multi_select ?? []).map((o: any) => o.name)
      if ('contains' in cond) return names.includes(cond.contains)
      if ('does_not_contain' in cond) return !names.includes(cond.does_not_contain)
      if ('is_empty' in cond) return cond.is_empty === (names.length === 0)
      if ('is_not_empty' in cond) return cond.is_not_empty === (names.length > 0)
      return true }
    case 'date': return cmpDate(p.date?.start ?? '', cond)
    case 'checkbox': return 'equals' in cond ? !!p.checkbox === !!cond.equals : 'does_not_equal' in cond ? !!p.checkbox !== !!cond.does_not_equal : true
    case 'number': { const v = p.number
      if ('is_empty' in cond) return cond.is_empty === (v == null)
      if ('is_not_empty' in cond) return cond.is_not_empty === (v != null)
      if (v == null) return false
      if ('equals' in cond) return v === cond.equals
      if ('does_not_equal' in cond) return v !== cond.does_not_equal
      if ('greater_than' in cond) return v > cond.greater_than
      if ('less_than' in cond) return v < cond.less_than
      if ('greater_than_or_equal_to' in cond) return v >= cond.greater_than_or_equal_to
      if ('less_than_or_equal_to' in cond) return v <= cond.less_than_or_equal_to
      return true }
    case 'relation': case 'people': { const ids = (p[p.type] ?? []).map((r: any) => bare(r.id))
      if ('contains' in cond) return ids.includes(bare(cond.contains))
      if ('does_not_contain' in cond) return !ids.includes(bare(cond.does_not_contain))
      if ('is_empty' in cond) return cond.is_empty === (ids.length === 0)
      if ('is_not_empty' in cond) return cond.is_not_empty === (ids.length > 0)
      return true }
    case 'unique_id': { const v = p.unique_id?.number
      if ('equals' in cond) return v === cond.equals
      if ('is_empty' in cond) return cond.is_empty === (v == null)
      return true }
    case 'formula': { const inner = p.formula ?? {}; const sub = Object.keys(cond)[0]; const c = cond[sub]
      if (sub === 'string') return cmpText(inner.string ?? '', c)
      if (sub === 'number') return matchFilter({ properties: { x: { type: 'number', number: inner.number } } }, { property: 'x', number: c })
      if (sub === 'checkbox') return !!inner.boolean === !!c.equals
      if (sub === 'date') return cmpDate(inner.date?.start ?? '', c)
      return true }
    default: return true
  }
}
function cmpText(v: string, cond: any, exact = false): boolean {
  if ('equals' in cond) return v === cond.equals
  if ('does_not_equal' in cond) return v !== cond.does_not_equal
  if ('contains' in cond) return v.toLowerCase().includes(String(cond.contains).toLowerCase())
  if ('does_not_contain' in cond) return !v.toLowerCase().includes(String(cond.does_not_contain).toLowerCase())
  if ('starts_with' in cond) return v.startsWith(cond.starts_with)
  if ('ends_with' in cond) return v.endsWith(cond.ends_with)
  if ('is_empty' in cond) return cond.is_empty === (v === '')
  if ('is_not_empty' in cond) return cond.is_not_empty === (v !== '')
  return true
}
function cmpDate(v: string, cond: any): boolean {
  const d = (x: string) => x ? x.slice(0, 10) : ''
  if ('is_empty' in cond) return cond.is_empty === (!v)
  if ('is_not_empty' in cond) return cond.is_not_empty === (!!v)
  if (!v) return false
  const a = v.length > 10 ? v : d(v)
  const key = Object.keys(cond)[0]; const b = cond[key]
  const A = a.length > 10 ? Date.parse(a) : Date.parse(d(a) + 'T00:00:00Z'), B = Date.parse(String(b).length > 10 ? b : d(b) + 'T00:00:00Z')
  switch (key) {
    case 'equals': return d(a) === d(b)
    case 'before': return A < B
    case 'after': return a.length > 10 ? A > B : d(a) > d(b)
    case 'on_or_before': return a.length > 10 ? A <= B : d(a) <= d(b)
    case 'on_or_after': return A >= B
    case 'past_week': return A >= Date.now() - 7 * 864e5
    case 'past_month': return A >= Date.now() - 30 * 864e5
    case 'past_year': return A >= Date.now() - 365 * 864e5
    case 'this_week': return A >= Date.now() - 7 * 864e5
    case 'next_week': case 'next_month': case 'next_year': return A >= Date.now()
    default: return true
  }
}
function sortKey(page: any, prop: string): any {
  const p = propValue(page, prop)
  if (typeof p === 'string') return p
  if (!p) return ''
  switch (p.type) {
    case 'title': case 'rich_text': return plain(p)
    case 'select': case 'status': return p[p.type]?.name ?? ''
    case 'date': return p.date?.start ?? ''
    case 'number': return p.number ?? -Infinity
    case 'checkbox': return p.checkbox ? 1 : 0
    case 'unique_id': return p.unique_id?.number ?? -Infinity
    case 'created_time': case 'last_edited_time': return p[p.type] ?? ''
    case 'formula': return p.formula?.string ?? p.formula?.number ?? p.formula?.date?.start ?? ''
    default: return ''
  }
}

// ── 頁面物件 ─────────────────────────────────────────────────────────────
function toPage(r: any): any {
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v))
  return {
    object: 'page', id: dashed(r.page_id), created_time: iso(r.created_time), last_edited_time: iso(r.last_edited_time), archived: !!r.archived,
    parent: { type: 'database_id', database_id: dashed(r.db_id) }, properties: r.properties, cover: r.cover ?? null, icon: r.icon ?? null,
    url: `https://www.notion.so/${r.page_id}`,
  }
}
async function loadSchema(dbId: string): Promise<{ title: string; schema: Record<string, any> }> {
  const r = await sql()`select title, schema from notion_databases where db_id = ${bare(dbId)}`
  if (!r.length) throw Object.assign(new Error(`store: 資料庫 ${dbId} 未搬入`), { code: 'object_not_found' })
  return { title: r[0].title, schema: r[0].schema }
}

// ── SQL 下推：常見的 filter／sort 直接在資料庫做，避免每次查詢把整庫載回來（稽核 8 千多筆、標案近千筆）──
// 任何一個節點翻不成 SQL 就回 null，整個查詢退回「全載入後在程式過濾」，結果一律與 matchFilter 相同。
function filterToSql(f: any, params: any[]): string | null {
  if (!f) return 'true'
  const P = (v: any) => { params.push(v); return '$' + params.length }
  if (f.and || f.or) {
    const parts: string[] = []
    for (const x of (f.and ?? f.or)) { const t = filterToSql(x, params); if (t == null) return null; parts.push('(' + t + ')') }
    return parts.length ? parts.join(f.and ? ' and ' : ' or ') : 'true'
  }
  const ts = (expr: string, cond: any): string | null => {
    const key = Object.keys(cond)[0], b = cond[key]
    if (key === 'is_empty') return b ? expr + ' is null' : expr + ' is not null'
    if (key === 'is_not_empty') return b ? expr + ' is not null' : expr + ' is null'
    if (typeof b !== 'string') return null
    const op = ({ before: '<', after: '>', on_or_before: '<=', on_or_after: '>=' } as Record<string, string>)[key]
    if (op) return '(' + expr + ')::timestamptz ' + op + ' ' + P(b) + '::timestamptz'
    if (key === 'equals') return 'left(' + expr + ', 10) = ' + P(b.slice(0, 10))
    return null
  }
  if (f.timestamp) {
    const col = f.timestamp === 'created_time' ? 'created_time' : 'last_edited_time'
    return ts("to_char(" + col + " at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')", f[f.timestamp])
  }
  const kind = Object.keys(f).find((k) => !['property', 'type'].includes(k))
  if (!kind || typeof f.property !== 'string') return null
  const cond = f[kind]; if (!cond || typeof cond !== 'object') return null
  const prop = 'properties->' + P(f.property)
  const key = Object.keys(cond)[0], val = cond[key]
  const textOps = (expr: string): string | null => {
    switch (key) {
      case 'equals': return expr + ' = ' + P(String(val))
      case 'does_not_equal': return expr + ' <> ' + P(String(val))
      case 'contains': return 'position(lower(' + P(String(val)) + ') in lower(' + expr + ')) > 0'
      case 'does_not_contain': return 'position(lower(' + P(String(val)) + ') in lower(' + expr + ')) = 0'
      case 'is_empty': return val ? expr + " = ''" : expr + " <> ''"
      case 'is_not_empty': return val ? expr + " <> ''" : expr + " = ''"
      default: return null
    }
  }
  const countOf = (arrKey: string) => "(select count(*) from jsonb_array_elements(coalesce(" + prop + "->'" + arrKey + "', '[]'::jsonb)) e"
  switch (kind) {
    case 'title': case 'rich_text':
      return textOps("(select coalesce(string_agg(coalesce(e->>'plain_text', e->'text'->>'content', ''), '' order by o), '') from jsonb_array_elements(coalesce(" + prop + "->'title', " + prop + "->'rich_text', '[]'::jsonb)) with ordinality as t(e, o))")
    case 'select': case 'status':
      return textOps("coalesce(" + prop + "->'select'->>'name', " + prop + "->'status'->>'name', '')")
    case 'url': case 'phone_number': case 'email':
      return textOps("coalesce(" + prop + "->>'" + kind + "', '')")
    case 'checkbox':
      if (key === 'equals') return "coalesce((" + prop + "->>'checkbox')::boolean, false) = " + P(!!val)
      if (key === 'does_not_equal') return "coalesce((" + prop + "->>'checkbox')::boolean, false) <> " + P(!!val)
      return null
    case 'date': return ts(prop + "->'date'->>'start'", cond)
    case 'relation': {
      const c = countOf('relation')
      if (key === 'contains') return c + " where replace(e->>'id', '-', '') = " + P(bare(String(val))) + ') > 0'
      if (key === 'does_not_contain') return c + " where replace(e->>'id', '-', '') = " + P(bare(String(val))) + ') = 0'
      if (key === 'is_empty') return val ? c + ') = 0' : c + ') > 0'
      if (key === 'is_not_empty') return val ? c + ') > 0' : c + ') = 0'
      return null
    }
    case 'multi_select': {
      const c = countOf('multi_select')
      if (key === 'contains') return c + " where e->>'name' = " + P(String(val)) + ') > 0'
      if (key === 'does_not_contain') return c + " where e->>'name' = " + P(String(val)) + ') = 0'
      if (key === 'is_empty') return val ? c + ') = 0' : c + ') > 0'
      if (key === 'is_not_empty') return val ? c + ') > 0' : c + ') = 0'
      return null
    }
    case 'number': {
      const n = "(" + prop + "->>'number')::numeric"
      const op = ({ equals: '=', does_not_equal: '<>', greater_than: '>', less_than: '<', greater_than_or_equal_to: '>=', less_than_or_equal_to: '<=' } as Record<string, string>)[key]
      if (op) return n + ' ' + op + ' ' + P(Number(val))
      if (key === 'is_empty') return val ? n + ' is null' : n + ' is not null'
      if (key === 'is_not_empty') return val ? n + ' is not null' : n + ' is null'
      return null
    }
    default: return null
  }
}
/** 只下推「值在 SQL 與程式排序一定相同」的排序：時間戳、日期欄、數字欄 */
function sortsToSql(sorts: any[], schema: Record<string, any>, params: any[]): string | null {
  const P = (v: any) => { params.push(v); return '$' + params.length }
  const out: string[] = []
  for (const s of sorts) {
    const dir = s.direction === 'descending' ? 'desc' : 'asc'
    let expr: string | null = null
    if (s.timestamp === 'created_time' || s.property === 'created_time') expr = 'created_time'
    else if (s.timestamp === 'last_edited_time' || s.property === 'last_edited_time') expr = 'last_edited_time'
    else if (s.property && schema[s.property]?.type === 'date') expr = "coalesce(properties->" + P(s.property) + "->'date'->>'start', '')"
    else if (s.property && schema[s.property]?.type === 'number') expr = "coalesce((properties->" + P(s.property) + "->>'number')::numeric, '-Infinity'::numeric)"
    if (!expr) return null
    out.push(expr + ' ' + dir)
  }
  return out.join(', ')
}
async function querySqlPushdown(args: any, dbId: string, size: number, offset: number): Promise<any | null> {
  if (process.env.NOTION_STORE_NO_PUSHDOWN === '1') return null   // 比對／除錯用
  const params: any[] = [dbId]
  const where = filterToSql(args.filter, params)
  if (where == null) return null
  const sorts: any[] = args.sorts ?? []
  const order = sorts.length ? sortsToSql(sorts, (await loadSchema(dbId)).schema, params) : 'created_time desc'
  if (order == null) return null
  const text = 'select * from notion_pages where db_id = $1 and not archived and (' + where + ') order by ' + order + ', page_id limit ' + (size + 1) + ' offset ' + offset
  const rows = (await sql().unsafe(text, params)) as any[]
  const hasMore = rows.length > size
  return { object: 'list', results: rows.slice(0, size).map(toPage), has_more: hasMore, next_cursor: hasMore ? 'o:' + (offset + size) : null, type: 'page_or_database', page_or_database: {} }
}

// ── 對外介面（與 @notionhq/client 同形狀）────────────────────────────────
export const store = {
  databases: {
    async query(args: any) {
      const dbId = bare(args.database_id)
      // 能整個翻成 SQL 的查詢：在資料庫過濾、排序、分頁；翻不了或出錯就走下面的全載入
      try {
        const pushed = await querySqlPushdown(args, dbId, Math.min(Number(args.page_size) || 100, 100), args.start_cursor ? Number(String(args.start_cursor).replace(/^o:/, '')) || 0 : 0)
        if (pushed) return pushed
      } catch (e) {
        console.warn('[notion-store] SQL 下推失敗，改用全載入：', (e as Error).message)
      }
      const rows = await sql()`select * from notion_pages where db_id = ${dbId} and not archived order by page_id`   // 固定基底順序，同值時分頁才穩定
      let pages = rows.map(toPage).filter((p) => matchFilter(p, args.filter))
      const sorts: any[] = args.sorts ?? []
      if (sorts.length) pages.sort((a, b) => {
        for (const s of sorts) {
          const prop = s.property ?? s.timestamp
          const ka = sortKey(a, prop), kb = sortKey(b, prop)
          const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'zh-TW')
          if (c !== 0) return s.direction === 'descending' ? -c : c
        }
        return 0
      })
      else pages.sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)))   // Notion 無 sorts 時實測為建立時間新→舊
      const size = Math.min(Number(args.page_size) || 100, 100)
      const offset = args.start_cursor ? Number(String(args.start_cursor).replace(/^o:/, '')) || 0 : 0
      const slice = pages.slice(offset, offset + size)
      const hasMore = offset + size < pages.length
      return { object: 'list', results: slice, has_more: hasMore, next_cursor: hasMore ? `o:${offset + size}` : null, type: 'page_or_database', page_or_database: {} }
    },
    async retrieve(args: any) {
      const { title, schema } = await loadSchema(args.database_id)
      return { object: 'database', id: dashed(args.database_id), title: richOut([{ text: { content: title } }]), properties: schema, archived: false }
    },
    async update(args: any) {
      const dbId = bare(args.database_id)
      const { title, schema } = await loadSchema(dbId)
      const next = { ...schema }
      for (const [name, def] of Object.entries(args.properties ?? {}) as [string, any][]) {
        if (def === null) { delete next[name]; continue }
        const type = Object.keys(def).find((k) => k !== 'name' && k !== 'type') ?? def.type
        if (!type) continue
        const prev = next[name]
        const merged = { id: prev?.id ?? name, name, type, [type]: { ...(prev?.[type] ?? {}), ...(def[type] ?? {}) } }
        // 選項只增不減（Notion 傳整組會覆蓋，這裡保守合併）
        if (['select', 'status', 'multi_select'].includes(type) && prev?.[type]?.options) {
          const incoming: any[] = def[type]?.options ?? []
          const names = new Set(incoming.map((o: any) => o.name))
          merged[type].options = [...prev[type].options, ...incoming.filter((o: any) => !prev[type].options.some((p: any) => p.name === o.name))]
          void names
        }
        next[name] = merged
      }
      const newTitle = args.title ? args.title.map((t: any) => t?.text?.content ?? t?.plain_text ?? '').join('') : title
      await sql()`update notion_databases set schema = ${sql().json(next)}, title = ${newTitle} where db_id = ${dbId}`
      return { object: 'database', id: dashed(dbId), title: richOut([{ text: { content: newTitle } }]), properties: next }
    },
  },
  pages: {
    async create(args: any) {
      const dbId = bare(args.parent?.database_id)
      const { schema } = await loadSchema(dbId)
      const props = normalizeWrite(schema, args.properties)
      // unique_id 欄位自動發號
      for (const [name, def] of Object.entries(schema) as [string, any][]) {
        if (def.type === 'unique_id' && !props[name]) {
          const [m] = await sql()`select coalesce(max((properties->${name}->'unique_id'->>'number')::int), 0)::int n from notion_pages where db_id = ${dbId}`
          props[name] = { id: def.id ?? name, type: 'unique_id', unique_id: { prefix: def.unique_id?.prefix ?? null, number: m.n + 1 } }
        }
      }
      // schema 可能新增了選項
      await sql()`update notion_databases set schema = ${sql().json(schema)} where db_id = ${dbId}`
      const id = randomUUID().replace(/-/g, '')
      const now = new Date().toISOString()
      await sql()`insert into notion_pages (page_id, db_id, properties, created_time, last_edited_time, archived, cover, icon)
        values (${id}, ${dbId}, ${sql().json(props)}, ${now}, ${now}, false, ${args.cover ? sql().json(args.cover) : null}, ${args.icon ? sql().json(args.icon) : null})`
      return toPage({ page_id: id, db_id: dbId, properties: props, created_time: now, last_edited_time: now, archived: false, cover: args.cover ?? null, icon: args.icon ?? null })
    },
    async retrieve(args: any) {
      const r = await sql()`select * from notion_pages where page_id = ${bare(args.page_id)}`
      if (!r.length) throw Object.assign(new Error(`Could not find page with ID: ${args.page_id}`), { code: 'object_not_found', status: 404 })
      return toPage(r[0])
    },
    async update(args: any) {
      const id = bare(args.page_id)
      const r = await sql()`select * from notion_pages where page_id = ${id}`
      if (!r.length) throw Object.assign(new Error(`Could not find page with ID: ${args.page_id}`), { code: 'object_not_found', status: 404 })
      const row = r[0]
      const { schema } = await loadSchema(row.db_id)
      const props = { ...row.properties, ...normalizeWrite(schema, args.properties ?? {}) }
      await sql()`update notion_databases set schema = ${sql().json(schema)} where db_id = ${row.db_id}`
      const archived = args.archived ?? args.in_trash ?? row.archived
      const now = new Date().toISOString()
      await sql()`update notion_pages set properties = ${sql().json(props)}, archived = ${archived}, last_edited_time = ${now},
        cover = coalesce(${args.cover ? sql().json(args.cover) : null}, cover), icon = coalesce(${args.icon ? sql().json(args.icon) : null}, icon) where page_id = ${id}`
      return toPage({ ...row, properties: props, archived, last_edited_time: now })
    },
  },
  blocks: {
    children: { async list(_args: any) { return { object: 'list', results: [], has_more: false, next_cursor: null } } },
  },
}

/** 把真正的 Notion client 包成代理：已搬入的庫／頁面走 store，其餘照舊打 Notion。 */
export function createNotionProxy(real: any): any {
  // NOTION_STORE_DISABLED=1：全部回到 Notion（比對／緊急退回用；已搬入後 Notion 端不再更新，只能短期使用）
  const route = async (kind: 'db' | 'page', id: string) => process.env.NOTION_STORE_DISABLED === '1' ? false : (kind === 'db' ? isStoredDb(id) : isStoredPage(id))
  return {
    ...real,
    databases: {
      ...real.databases,
      query: async (a: any) => (await route('db', a.database_id)) ? store.databases.query(a) : real.databases.query(a),
      retrieve: async (a: any) => (await route('db', a.database_id)) ? store.databases.retrieve(a) : real.databases.retrieve(a),
      update: async (a: any) => (await route('db', a.database_id)) ? store.databases.update(a) : real.databases.update(a),
      create: (a: any) => real.databases.create(a),
    },
    pages: {
      ...real.pages,
      create: async (a: any) => (a.parent?.database_id && (await route('db', a.parent.database_id))) ? store.pages.create(a) : real.pages.create(a),
      retrieve: async (a: any) => (await route('page', a.page_id)) ? store.pages.retrieve(a) : real.pages.retrieve(a),
      update: async (a: any) => (await route('page', a.page_id)) ? store.pages.update(a) : real.pages.update(a),
    },
    blocks: {
      ...real.blocks,
      children: { ...real.blocks.children, list: async (a: any) => (await route('page', a.block_id)) ? store.blocks.children.list(a) : real.blocks.children.list(a) },
    },
  }
}
