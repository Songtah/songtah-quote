/**
 * lib/notion/medical-monitor.ts — 醫事監控（葉領域，從 system-notion.ts 抽出）
 * 最近比對結果（Redis）、每月趨勢紀錄（Redis + Notion 永久 DB）、本月異動、診所監控紀錄。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getRedisValue, setRedisValue, getText,
} from './shared'

// ── 最近一次比對結果（伺服器端共用，跨裝置/不受清快取影響）──────────
const MONITOR_RESULT_KEY = 'medical-monitor:last-result'
export async function getCachedMonitorResult<T = unknown>(): Promise<T | null> {
  return getRedisValue<T>(MONITOR_RESULT_KEY)
}
export async function setCachedMonitorResult(value: unknown): Promise<void> {
  return setRedisValue(MONITOR_RESULT_KEY, value, 30 * 24 * 60 * 60_000) // 30 天
}

// ── 比對紀錄（每月摘要趨勢，供對照；伺服器端持久、刷新不消失）──────────
const MONITOR_HISTORY_KEY = 'medical-monitor:history'
export interface MonitorHistoryEntry {
  month:             string   // 快照月份 YYYY-MM（一個月一筆，重複比對會更新同月）
  computedAt:        string
  totalClinics:      number   // 全台：診所+衛生所
  totalLabs:         number   // 全台：牙技+鑲牙
  totalHospitals:    number   // 全台：醫院
  totalSchools:      number   // 全台：學校（教育部 schools.json）
  custClinics:       number   // 崧達客戶：牙醫診所+衛生所
  custLabs:          number   // 崧達客戶：牙體技術所+鑲牙所
  custHospitals:     number   // 崧達客戶：醫院
  custSchools:       number   // 崧達客戶：學術機構
  customerWithCode:  number
  inBasOpen:         number   // 客戶代碼比中 BAS 開業
  toDevelop:         number   // 待開發（BAS 有、非客戶）
  suspectedClosures: number
  hospitalUnverified:number
  codeChanged:       number
  inconsistentData:  number
}
export async function getMonitorHistory(): Promise<MonitorHistoryEntry[]> {
  return (await getRedisValue<MonitorHistoryEntry[]>(MONITOR_HISTORY_KEY)) ?? []
}
export async function pushMonitorHistory(entry: MonitorHistoryEntry): Promise<void> {
  const list = (await getRedisValue<MonitorHistoryEntry[]>(MONITOR_HISTORY_KEY)) ?? []
  const idx = list.findIndex(r => r.month === entry.month)
  if (idx >= 0) list[idx] = entry; else list.push(entry)
  list.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)) // 新到舊
  await setRedisValue(MONITOR_HISTORY_KEY, list.slice(0, 36), 400 * 24 * 60 * 60_000) // 約 13 個月
}

/** 讀「診所監控紀錄」DB 某月的逐筆異動（本月異動視圖用）*/
export interface MonthlyChange {
  type: string; name: string; code: string; address: string; customer: string; customerUrl: string
}
export async function getMonthlyMonitorChanges(month: string): Promise<MonthlyChange[]> {
  if (!DB.monitor) return []
  const dbId = normalizeDatabaseId(DB.monitor)
  const WANT = new Set(['新開業', '新增停業', '停業', '恢復開業'])
  const out: MonthlyChange[] = []
  let cursor: string | undefined
  try {
    do {
      const res: any = await notionCallWithRetry('getMonthlyMonitorChanges', () =>
        notion.databases.query({
          database_id: dbId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
          filter: { property: '月份', date: { equals: `${month}-01` } },
        })
      )
      for (const p of res.results ?? []) {
        const type = p.properties?.['異動類型']?.select?.name ?? ''
        if (!WANT.has(type)) continue
        out.push({
          type,
          name:        getText(p, '健保名稱'),
          code:        getText(p, '機構代碼'),
          address:     getText(p, '地址'),
          customer:    getText(p, '客戶名稱'),
          customerUrl: p.properties?.['客戶頁面']?.url ?? '',
        })
      }
      cursor = res.has_more ? res.next_cursor : undefined
    } while (cursor)
  } catch { /* 無紀錄回空 */ }
  return out
}

/** 寫入「醫事數量趨勢」Notion DB（永久紀錄，一月一列；以月份 title upsert）*/
export async function upsertMedicalTrend(e: MonitorHistoryEntry): Promise<void> {
  if (!DB.medicalTrend) return
  const dbId = normalizeDatabaseId(DB.medicalTrend)
  const props: any = {
    '月份':           { title: [{ text: { content: e.month } }] },
    '紀錄時間':       { date: { start: e.computedAt } },
    '全台_牙醫診所':  { number: e.totalClinics },
    '全台_牙體技術所':{ number: e.totalLabs },
    '全台_醫院':      { number: e.totalHospitals },
    '全台_學校':      { number: e.totalSchools },
    '客戶_牙醫診所':  { number: e.custClinics },
    '客戶_牙體技術所':{ number: e.custLabs },
    '客戶_醫院':      { number: e.custHospitals },
    '客戶_學校':      { number: e.custSchools },
    '客戶有代碼':     { number: e.customerWithCode },
    '在BAS開業':      { number: e.inBasOpen },
    '待開發':         { number: e.toDevelop },
    '疑似歇業':       { number: e.suspectedClosures },
    '醫院待確認':     { number: e.hospitalUnverified },
    '更換代碼':       { number: e.codeChanged },
    '資料不一致':     { number: e.inconsistentData },
  }
  // 以月份查詢既有列 → 有則更新、無則新增（一月一列）
  const q: any = await notionCallWithRetry('upsertMedicalTrend:find', () =>
    notion.databases.query({ database_id: dbId, filter: { property: '月份', title: { equals: e.month } }, page_size: 1 })
  )
  const existing = q.results?.[0]
  if (existing) {
    await notionCallWithRetry('upsertMedicalTrend:update', () =>
      notion.pages.update({ page_id: existing.id, properties: props })
    )
  } else {
    await notionCallWithRetry('upsertMedicalTrend:create', () =>
      notion.pages.create({ parent: { database_id: dbId }, properties: props })
    )
  }
}

// ─── 診所監控紀錄（月排程寫入的逐筆異動）─────────────────────────────────────────
export type ClinicMonitorRecord = {
  id: string
  title: string
  month: string        // YYYY-MM
  type: '新增停業' | '恢復開業' | '新開業' | '停業' | '查無代碼' | '月份摘要'
  institutionCode: string
  nhiName: string
  customerName: string
  customerUrl: string
  address: string
  specialty: string
  termDate: string     // ISO date or empty
}

export type ClinicMonitorSummary = {
  month: string
  totalActive: number
  stopped: number
  restored: number
  notFound: number
  affectedCustomers: number
}

function mapClinicRecord(page: any): ClinicMonitorRecord {
  const props = page.properties
  const getT  = (f: string) => props[f]?.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  const getU  = (f: string) => props[f]?.url ?? ''
  const getDt = (f: string) => props[f]?.date?.start ?? ''
  const getSel= (f: string) => props[f]?.select?.name ?? ''
  const title = props['標題']?.title?.map((t: any) => t.plain_text).join('') ?? ''
  const monthRaw = getDt('月份')   // YYYY-MM-DD
  const month = monthRaw ? monthRaw.slice(0, 7) : ''

  return {
    id:              page.id,
    title,
    month,
    type:            getSel('異動類型') as ClinicMonitorRecord['type'],
    institutionCode: getT('機構代碼'),
    nhiName:         getT('健保名稱'),
    customerName:    getT('客戶名稱'),
    customerUrl:     getU('客戶頁面'),
    address:         getT('地址'),
    specialty:       getT('診療科別'),
    termDate:        getDt('終止日期'),
  }
}

/** 取得診所監控紀錄（最近 N 個月，預設 3 個月） */
export async function getClinicMonitorRecords(months = 3): Promise<ClinicMonitorRecord[]> {
  const dbId = process.env.NOTION_CLINIC_MONITOR_DB
  if (!dbId) return []

  const cacheKey = `clinic-monitor:${months}`
  const cached = await getRedisValue<ClinicMonitorRecord[]>(cacheKey)
  if (cached) return cached

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const records: ClinicMonitorRecord[] = []
  let cursor: string | undefined

  do {
    const body: any = {
      page_size: 100,
      sorts: [{ property: '月份', direction: 'descending' }],
      filter: {
        property: '月份',
        date: { on_or_after: cutoffDate },
      },
    }
    if (cursor) body.start_cursor = cursor

    const res = await notionCallWithRetry('getClinicMonitorRecords', () =>
      notion.databases.query({ database_id: dbId, ...body })
    ) as any

    for (const page of res.results) {
      records.push(mapClinicRecord(page))
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  await setRedisValue(cacheKey, records, 10 * 60_000)  // cache 10 min
  return records
}
