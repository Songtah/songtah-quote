/**
 * lib/db/sync-notion.ts — Notion → Supabase 全量同步（客戶主檔、客情紀錄）
 *
 * 搬遷第二步「每晚同步並比對」。系統仍以 Notion 為主，這裡只是鏡像。
 *  - 客戶依縣市分區掃描（Notion 單一查詢 >10,000 筆會靜默截斷）
 *  - 以 notion_page_id upsert；Notion 已不存在的列移除（單表消失 >5% 時不刪，只記警告）
 *  - 每次寫一筆 sync_runs，供中央管理頁檢視
 * 規格：docs/strategy/2026-11-09-客戶主檔搬遷Supabase規格.md
 */
import { DB, notion, normalizeDatabaseId, notionCallWithRetry } from '@/lib/notion/shared'
import { sql } from '@/lib/db/client'

const txt = (p: any) => ((p?.rich_text ?? p?.title ?? []) as any[]).map((t) => t.plain_text).join('').trim() || null
const sel = (p: any) => p?.select?.name ?? p?.status?.name ?? null
const multi = (p: any): string[] => (p?.multi_select ?? []).map((o: any) => o.name)
const num = (p: any) => (p?.number == null ? null : Math.trunc(p.number))
const bool = (p: any) => p?.checkbox === true
const url = (p: any) => p?.url ?? null
const phone = (p: any) => p?.phone_number ?? null
const date = (p: any) => p?.date?.start?.slice(0, 10) ?? null
const rel = (p: any): string[] => (p?.relation ?? []).map((r: any) => r.id)

export function mapCustomer(pg: any) {
  const P = pg.properties
  return {
    notion_page_id: pg.id as string, name: txt(P['客戶名稱']) ?? '(無名稱)', customer_type: sel(P['客戶類型']), county: sel(P['縣市']),
    district: txt(P['行政區']), address: txt(P['地址']), phone: phone(P['電話']), institution_status: sel(P['機構狀態']),
    institution_code: txt(P['機構代碼']), dentist_count: num(P['牙醫師數']), technician_count: num(P['牙體技術師數']), trainee_count: num(P['牙體技術生數']),
    institution_url: url(P['機構資料']), departments_url: url(P['診療科別連結']), staff_url: url(P['醫事人員連結']), nhi_contracted: bool(P['健保特約']),
    dev_stage: sel(P['開發階段']), dev_source: sel(P['開發來源']), owner: sel(P['負責業務']), dev_status_tags: multi(P['開發狀態']),
    principal: txt(P['負責人']), opportunity_tags: multi(P['商機標籤']), departments: multi(P['診療科別']), related_company: txt(P['相關公司行號']),
    grade: sel(P['客戶等級']), has_lab: bool(P['附屬技工室']), erp_updated: bool(P['ERP 更新']),
    notion_created_at: pg.created_time as string, notion_updated_at: pg.last_edited_time as string, synced_at: new Date().toISOString(),
  }
}
export function mapVisit(pg: any) {
  const P = pg.properties
  return {
    notion_page_id: pg.id as string, customer_notion_id: rel(P['🏥 牙科單位資料'])[0] ?? null, unit_name: txt(P['單位名稱']) ?? '(無名稱)',
    visit_date: date(P['日期']), salesperson: sel(P['業務人員']), content: txt(P['拜訪內容']), address: txt(P['地址']),
    interaction_type: sel(P['互動類型']), reaction: sel(P['客戶反應']), needs_follow_up: bool(P['是否需追蹤']), next_follow_up: date(P['下次追蹤日']),
    follow_up_closed: bool(P['追蹤已結案']), contact_name: txt(P['聯絡人']), contact_phone: phone(P['聯絡電話']), competitors: multi(P['競品']),
    customer_tags: multi(P['客戶標籤']), next_action: txt(P['後續動作']), purpose: sel(P['互動目的']), visit_nature: sel(P['拜訪性質']), status: sel(P['狀態']),
    interested_product_ids: rel(P['有興趣的產品']), recommended_product_ids: rel(P['推薦產品']),
    notion_created_at: pg.created_time as string, notion_updated_at: pg.last_edited_time as string, synced_at: new Date().toISOString(),
  }
}

async function scan(dbId: string, filter: any, onPage: (p: any) => void) {
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('db-sync:scan', () =>
      notion.databases.query({ database_id: normalizeDatabaseId(dbId), page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) }),
    )
    for (const p of res.results ?? []) onPage(p)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
}

export type SyncResult = {
  runId: number
  customers: { seen: number; upserted: number; removed: number }
  visits: { seen: number; upserted: number; removed: number; unlinked: number }
  warnings: string[]
  seconds: number
}

// 欄位名只來自本檔的 map 函式，非外部輸入
const upsertSet = (cols: string[]) => cols.filter((c) => c !== 'notion_page_id').map((c) => `"${c}" = excluded."${c}"`).join(', ')
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

export async function runFullSync(): Promise<SyncResult> {
  if (!DB.customers || !DB.visits) throw new Error('Notion 客戶／客情資料庫 ID 未設定')
  const db = sql()
  const t0 = Date.now()
  const [run] = await db`insert into sync_runs (source) values ('notion') returning id`
  const warnings: string[] = []

  const customers = new Map<string, ReturnType<typeof mapCustomer>>()
  const meta: any = await notionCallWithRetry('db-sync:schema', () => notion.databases.retrieve({ database_id: normalizeDatabaseId(DB.customers!) }))
  const counties: string[] = (meta.properties?.['縣市']?.select?.options ?? []).map((o: any) => o.name)
  for (const c of counties) await scan(DB.customers, { property: '縣市', select: { equals: c } }, (p) => customers.set(p.id, mapCustomer(p)))
  await scan(DB.customers, { property: '縣市', select: { is_empty: true } }, (p) => customers.set(p.id, mapCustomer(p)))

  const visits = new Map<string, ReturnType<typeof mapVisit>>()
  for (const f of [
    { property: '日期', date: { before: '2026-06-01' } },
    { property: '日期', date: { on_or_after: '2026-06-01' } },
    { property: '日期', date: { is_empty: true } },
  ]) await scan(DB.visits, f, (p) => visits.set(p.id, mapVisit(p)))

  // upsert 客戶
  const crows = Array.from(customers.values())
  const ccols = Object.keys(crows[0] ?? {}) as (keyof ReturnType<typeof mapCustomer>)[]
  let cu = 0
  for (const part of chunk(crows, 200)) {
    const r = await db`insert into customers ${(db as any)(part, ...ccols)} on conflict (notion_page_id) do update set ${db.unsafe(upsertSet(ccols as string[]))}`
    cu += r.count
  }
  const idMap = new Map<string, number>((await db`select id, notion_page_id from customers`).map((r: any) => [r.notion_page_id, r.id]))
  const vrows = Array.from(visits.values()).map((v) => ({ ...v, customer_id: v.customer_notion_id ? idMap.get(v.customer_notion_id) ?? null : null }))
  const unlinked = vrows.filter((v) => v.customer_id == null).length
  const vcols = Object.keys(vrows[0] ?? {})
  let vu = 0
  for (const part of chunk(vrows, 200)) {
    const r = await db`insert into visits ${(db as any)(part, ...vcols)} on conflict (notion_page_id) do update set ${db.unsafe(upsertSet(vcols))}`
    vu += r.count
  }

  // 移除 Notion 已不存在的列（防呆：>5% 不刪）
  const removed = { customers: 0, visits: 0 }
  for (const [table, seen] of [['customers', customers], ['visits', visits]] as const) {
    const have = await db`select notion_page_id from ${db(table)}`
    const gone = have.map((r: any) => r.notion_page_id as string).filter((id) => !seen.has(id))
    if (gone.length > have.length * 0.05) { warnings.push(`${table} 有 ${gone.length} 筆未在 Notion 出現（超過 5%），未刪除`); continue }
    if (gone.length) removed[table] = (await db`delete from ${db(table)} where notion_page_id in ${db(gone)}`).count
  }

  const seconds = Math.round((Date.now() - t0) / 1000)
  await db`update sync_runs set finished_at = now(), customers_seen = ${customers.size}, customers_upserted = ${cu},
    visits_seen = ${visits.size}, visits_upserted = ${vu}, visits_unlinked = ${unlinked},
    notes = ${JSON.stringify({ removed, warnings, seconds })} where id = ${run.id}`
  return { runId: run.id, customers: { seen: customers.size, upserted: cu, removed: removed.customers }, visits: { seen: visits.size, upserted: vu, removed: removed.visits, unlinked }, warnings, seconds }
}

export type SyncStatus = {
  dbCustomers: number; dbVisits: number; dbVisitsLinked: number
  lastRun: null | { id: number; startedAt: string; finishedAt: string | null; customersSeen: number | null; visitsSeen: number | null; visitsUnlinked: number | null; notes: any }
  recentRuns: { id: number; startedAt: string; finishedAt: string | null; customersSeen: number | null; visitsSeen: number | null; visitsUnlinked: number | null; ok: boolean }[]
}
export async function getSyncStatus(): Promise<SyncStatus> {
  const db = sql()
  const [c] = await db`select count(*)::int n from customers`
  const [v] = await db`select count(*)::int n, count(customer_id)::int linked from visits`
  const runs = await db`select id, started_at, finished_at, customers_seen, visits_seen, visits_unlinked, notes from sync_runs order by id desc limit 10`
  const toRun = (r: any) => ({ id: r.id, startedAt: r.started_at?.toISOString?.() ?? String(r.started_at), finishedAt: r.finished_at ? (r.finished_at.toISOString?.() ?? String(r.finished_at)) : null, customersSeen: r.customers_seen, visitsSeen: r.visits_seen, visitsUnlinked: r.visits_unlinked, notes: r.notes ? safeJson(r.notes) : null })
  return {
    dbCustomers: c.n, dbVisits: v.n, dbVisitsLinked: v.linked,
    lastRun: runs[0] ? toRun(runs[0]) : null,
    recentRuns: runs.map((r: any) => ({ ...toRun(r), ok: !!r.finished_at })),
  }
}
function safeJson(s: string) { try { return JSON.parse(s) } catch { return s } }
