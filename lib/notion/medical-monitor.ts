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

// ─── 近半年「新增／減少」趨勢（依機構類別）──────────────────────────────────────
//
// 使用者定義（2026-09-21）：
//   新增 ＝ 比對後增加的量　　　　　　　　　　　　→ 異動類型「新開業」
//   減少 ＝ 原先有機構代碼、比對後遺失或查不到　→ 異動類型「新增停業」與「查無代碼」
// 「恢復開業」刻意不計入新增：2026-06 首次建立快照時整批 7,839 筆都被標成恢復開業，
// 那是基準月的產物不是真實異動；之後每月只有個位數，計入只會讓圖失真。
//
// 「查無代碼」是**存量**不是月流量：實測 1,920 筆全部沒有月份欄位、且同一天產生
// （全量比對的結果）。有月份者計入該月減少，沒月份者另外回傳 codeNotFoundStock，
// 由 UI 以文字標註，不混進長條圖。
//
// 鐵則 #0：監控紀錄 DB 已超過 10,000 筆（無過濾查詢會靜默截斷），
// 故一律「逐月分區 + 只取三種異動類型」查詢。
export type MonitorTrendKind = '牙醫診所' | '牙體技術所' | '醫院'
export type MonitorKindTrendPoint = {
  month: string
  baseline: boolean                 // 首次快照月，數字僅供參考
  kinds: Record<MonitorTrendKind, { added: number; removed: number }>
}
export type MonitorKindTrend = {
  points: MonitorKindTrendPoint[]
  /** 沒有月份的「查無代碼」存量，以機構代碼去重（同一家每次比對都會再寫一筆，實測 9,185 列只有 1,532 家） */
  codeNotFoundStock: number
  codeNotFoundByKind: Record<MonitorTrendKind | '其他', number>
  computedAt: string
}

/** 由機構代碼與名稱判斷類別（實測 8,534 筆客戶代碼對照，命中率 99.2%） */
export function guessInstitutionKind(code: string, name: string): MonitorTrendKind | '其他' {
  const n = name ?? ''
  if (n.includes('鑲牙所')) return '牙體技術所'
  if ((code ?? '').startsWith('2')) return '牙體技術所'
  if (n.includes('醫院')) return '醫院'
  if (n.includes('衛生所') || n.includes('大學') || n.includes('學系')) return '其他'
  return '牙醫診所'
}

const TREND_KINDS: MonitorTrendKind[] = ['牙醫診所', '牙體技術所', '醫院']
const emptyKinds = () => Object.fromEntries(
  TREND_KINDS.map((k) => [k, { added: 0, removed: 0 }])
) as MonitorKindTrendPoint['kinds']

const KIND_TREND_KEY = 'medical-monitor:kind-trend-v1'

export async function getMonitorKindTrend(months = 6, options?: { refresh?: boolean }): Promise<MonitorKindTrend> {
  const dbId = process.env.NOTION_CLINIC_MONITOR_DB
  const empty: MonitorKindTrend = {
    points: [], codeNotFoundStock: 0,
    codeNotFoundByKind: { 牙醫診所: 0, 牙體技術所: 0, 醫院: 0, 其他: 0 },
    computedAt: new Date().toISOString(),
  }
  if (!dbId) return empty
  if (!options?.refresh) {
    const cached = await getRedisValue<MonitorKindTrend>(KIND_TREND_KEY)
    if (cached) return cached
  }

  // 近 N 個月（含本月），舊→新
  const now = new Date()
  const monthKeys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    monthKeys.push(d.toISOString().slice(0, 7))
  }

  const points: MonitorKindTrendPoint[] = []
  let stock = 0
  for (const month of monthKeys) {
    const kinds = emptyKinds()
    let cursor: string | undefined
    let total = 0
    do {
      const res: any = await notionCallWithRetry('getMonitorKindTrend', () =>
        notion.databases.query({
          database_id: normalizeDatabaseId(dbId),
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
          filter: {
            and: [
              { property: '月份', date: { equals: `${month}-01` } },
              { or: [
                { property: '異動類型', select: { equals: '新開業' } },
                { property: '異動類型', select: { equals: '新增停業' } },
                { property: '異動類型', select: { equals: '查無代碼' } },
              ] },
            ],
          },
        })
      )
      for (const page of res.results ?? []) {
        total++
        const type = page.properties?.['異動類型']?.select?.name ?? ''
        const code = getText(page, '機構代碼')
        const name = getText(page, '健保名稱') || getText(page, '客戶名稱')
        const kind = guessInstitutionKind(code, name)
        if (kind === '其他') continue
        if (type === '新開業') kinds[kind].added++
        else kinds[kind].removed++          // 新增停業 / 查無代碼
      }
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    points.push({ month, baseline: false, kinds })
    void total
  }

  // 首次快照月：只有新增、沒有減少（沒有前一個月可比），標記供 UI 註記，避免被誤讀成「那個月暴增」
  const firstWithData = points.find((p) =>
    TREND_KINDS.some((k) => p.kinds[k].added > 0 || p.kinds[k].removed > 0))
  if (firstWithData && TREND_KINDS.every((k) => firstWithData.kinds[k].removed === 0)) {
    firstWithData.baseline = true
  }

  // 沒有月份的「查無代碼」存量——必須以機構代碼去重：
  // 每次全量比對都會把同一家重寫一列，實測 9,185 列其實只有 1,532 家。
  const stockCodes = new Set<string>()
  const stockKinds: Record<string, Set<string>> = {}
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('getMonitorKindTrend:stock', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(dbId),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: {
          and: [
            { property: '異動類型', select: { equals: '查無代碼' } },
            { property: '月份', date: { is_empty: true } },
          ],
        },
      })
    )
    for (const page of res.results ?? []) {
      const code = getText(page, '機構代碼')
      if (!code || stockCodes.has(code)) continue
      stockCodes.add(code)
      const kind = guessInstitutionKind(code, getText(page, '健保名稱') || getText(page, '客戶名稱'))
      ;(stockKinds[kind] ??= new Set<string>()).add(code)
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  stock = stockCodes.size

  const out: MonitorKindTrend = {
    points,
    codeNotFoundStock: stock,
    codeNotFoundByKind: {
      牙醫診所: stockKinds['牙醫診所']?.size ?? 0,
      牙體技術所: stockKinds['牙體技術所']?.size ?? 0,
      醫院: stockKinds['醫院']?.size ?? 0,
      其他: stockKinds['其他']?.size ?? 0,
    },
    computedAt: new Date().toISOString(),
  }
  await setRedisValue(KIND_TREND_KEY, out, 6 * 60 * 60_000)   // 6 小時；資料每月才變一次
  return out
}

// ─── 未在衛福部登錄（查無代碼）清單 ────────────────────────────────────────────
//
// 客戶主檔有機構代碼，但比對 BAS 查不到。實測 1,532 家，其中牙體技術所 1,109 家——
// 使用者 2026-09-21 定調：這些多數是未立案（非法立案）機構，而本資料庫以合法立案為管理主體，
// 因此**獨立區隔**：不計入歇業判定、不混進新增／減少趨勢圖，單獨一區呈現即可。
//
// 注意：監控紀錄 DB 每次全量比對都會把同一家再寫一列（9,185 列實為 1,532 家），
// 故一律以機構代碼去重。
export type CodeNotFoundRow = {
  code: string
  name: string
  customerName: string
  kind: MonitorTrendKind | '其他'
  recordedAt: string
}

const CODE_NOT_FOUND_KEY = 'medical-monitor:code-not-found-v1'

export async function getCodeNotFoundList(options?: { refresh?: boolean }): Promise<{ rows: CodeNotFoundRow[]; computedAt: string }> {
  const dbId = process.env.NOTION_CLINIC_MONITOR_DB
  if (!dbId) return { rows: [], computedAt: new Date().toISOString() }
  if (!options?.refresh) {
    const cached = await getRedisValue<{ rows: CodeNotFoundRow[]; computedAt: string }>(CODE_NOT_FOUND_KEY)
    if (cached) return cached
  }
  const seen = new Map<string, CodeNotFoundRow>()
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('getCodeNotFoundList', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(dbId),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        filter: { property: '異動類型', select: { equals: '查無代碼' } },
      })
    )
    for (const page of res.results ?? []) {
      const code = getText(page, '機構代碼')
      if (!code) continue
      const name = getText(page, '健保名稱')
      const customerName = getText(page, '客戶名稱')
      const prev = seen.get(code)
      const recordedAt = (page.created_time ?? '').slice(0, 10)
      // 同一家留最新一次紀錄
      if (prev && prev.recordedAt >= recordedAt) continue
      seen.set(code, {
        code, name, customerName,
        kind: guessInstitutionKind(code, name || customerName),
        recordedAt,
      })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  const rows = Array.from(seen.values()).sort((a, b) =>
    a.kind === b.kind ? (a.customerName || a.name).localeCompare(b.customerName || b.name, 'zh-TW') : a.kind.localeCompare(b.kind))
  const out = { rows, computedAt: new Date().toISOString() }
  await setRedisValue(CODE_NOT_FOUND_KEY, out, 6 * 60 * 60_000)
  return out
}

/** 清掉「最近一次比對結果」快取——排除／復原後必須清，否則畫面還是舊清單 */
export async function invalidateMonitorResultCache(): Promise<void> {
  await setRedisValue(MONITOR_RESULT_KEY, null as any, 1)
}
