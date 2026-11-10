/**
 * lib/db/monitor.ts — 診所監控紀錄與醫事數量趨勢（Supabase）。2026-11-10 自 Notion 搬遷。
 */
import { sql } from './client'
import type { ClinicMonitorRecord, MonitorHistoryEntry } from '@/lib/notion/medical-monitor'

const d10 = (v: any) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const s = (v: any) => (v ?? '') as string

export type MonitorRecordInput = {
  type: string; month?: string; code?: string; key?: string; name?: string; customer?: string
  address?: string; specialty?: string; kind?: string; customerUrl?: string; termDate?: string; title?: string
}

function titleOf(rec: MonitorRecordInput): string {
  if (rec.title) return rec.title
  const name = rec.name ?? '', customer = rec.customer ?? ''
  return ({
    '新增停業': `🚨 ${name}（${customer}）`, '恢復開業': `✅ ${name}（${customer}）`, '新開業': `🆕 ${name}`,
    '停業': `⬜ ${name}`, '查無代碼': `🔍 ${customer}（機構代碼查無）`, '月份摘要': name,
  } as Record<string, string>)[rec.type] ?? `${rec.type}｜${name}`
}

export async function dbInsertMonitorRecords(recs: MonitorRecordInput[]): Promise<number> {
  if (!recs.length) return 0
  const rows = recs.map((r) => {
    const td = r.termDate && /^\d{8}$/.test(r.termDate) ? `${r.termDate.slice(0, 4)}-${r.termDate.slice(4, 6)}-${r.termDate.slice(6, 8)}` : (r.termDate && /^\d{4}-\d{2}-\d{2}/.test(r.termDate) ? r.termDate.slice(0, 10) : null)
    return {
      title: titleOf(r), month: r.month ? `${r.month.slice(0, 7)}-01` : null, type: r.type,
      institution_code: r.key || r.code || null, nhi_name: r.name || null, customer_name: r.customer || null,
      customer_url: r.customerUrl || null, address: r.address || null, specialty: r.specialty || r.kind || null, term_date: td,
    }
  })
  const db = sql()
  let n = 0
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200)
    const r = await db`insert into monitor_records ${(db as any)(part, ...Object.keys(part[0]))}`
    n += r.count
  }
  return n
}

const toRecord = (r: any): ClinicMonitorRecord => ({
  id: r.notion_page_id ?? String(r.id), title: s(r.title), month: r.month ? d10(r.month).slice(0, 7) : '',
  type: r.type, institutionCode: s(r.institution_code), nhiName: s(r.nhi_name), customerName: s(r.customer_name),
  customerUrl: s(r.customer_url), address: s(r.address), specialty: s(r.specialty), termDate: d10(r.term_date),
})

export async function dbMonitorRecordsSince(cutoffDate: string): Promise<ClinicMonitorRecord[]> {
  const rows = await sql()`select * from monitor_records where month >= ${cutoffDate} order by month desc, id desc`
  return rows.map(toRecord)
}

export async function dbMonitorRecordsForMonth(month: string, types?: string[]): Promise<ClinicMonitorRecord[]> {
  const rows = await sql()`select * from monitor_records where month = ${`${month}-01`} and (${types ?? null}::text[] is null or type = any(${types ?? null})) order by id`
  return rows.map(toRecord)
}

/** 查無代碼：每個代碼保留最新一筆 */
export async function dbCodeNotFoundLatest(): Promise<{ code: string; name: string; customerName: string; recordedAt: string }[]> {
  const rows = await sql()`select distinct on (institution_code) institution_code, nhi_name, customer_name, created_at
    from monitor_records where type = '查無代碼' and institution_code is not null and institution_code <> ''
    order by institution_code, created_at desc`
  return rows.map((r: any) => ({ code: r.institution_code, name: s(r.nhi_name), customerName: s(r.customer_name), recordedAt: d10(r.created_at) }))
}

export async function dbUpsertMedicalTrend(e: Partial<MonitorHistoryEntry> & { month: string }): Promise<void> {
  const row: Record<string, any> = {
    month: e.month, recorded_at: e.computedAt ?? new Date().toISOString(),
    total_clinics: e.totalClinics, total_labs: e.totalLabs, total_hospitals: e.totalHospitals, total_schools: e.totalSchools,
    cust_clinics: e.custClinics, cust_labs: e.custLabs, cust_hospitals: e.custHospitals, cust_schools: e.custSchools,
    customer_with_code: e.customerWithCode, in_bas_open: e.inBasOpen, to_develop: e.toDevelop,
    suspected_closures: e.suspectedClosures, hospital_unverified: e.hospitalUnverified, code_changed: e.codeChanged, inconsistent_data: e.inconsistentData,
  }
  for (const k of Object.keys(row)) if (row[k] === undefined || (typeof row[k] === 'number' && !Number.isFinite(row[k]))) delete row[k]
  const cols = Object.keys(row)
  const db = sql()
  await db`insert into medical_trend ${(db as any)([row], ...cols)} on conflict (month) do update set ${db.unsafe(cols.filter((c) => c !== 'month').map((c) => `"${c}" = excluded."${c}"`).join(', '))}`
}
