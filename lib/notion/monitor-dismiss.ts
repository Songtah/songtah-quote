/**
 * lib/notion/monitor-dismiss.ts — 醫事監控「排除異常」清單
 *
 * 有些候選每個月都會再跑出來，但人已經確認過不是問題（例：診所實際仍營業只是 BAS 未更新、
 * 醫院牙科本來就沒登記為牙醫一般科、代碼確定無誤）。這些要能被「略過」，
 * 否則每月比對都得重看一次同一批。
 *
 * 排除鍵刻意包含**當下的機構代碼**：`類別族:客戶id:代碼`。
 * 代碼一旦變動（換照、人工補正），鍵就對不上、該筆會自動重新出現——
 * 符合 CLAUDE.md「狀態必須能自己關閉」：排除不是永久埋葬，是針對「這個代碼的這個判定」。
 *
 * 排除是**人的判斷**，不是可重算的快取，所以（2026-10-07 修正誤報反覆出現）：
 *   - 存 Redis hash（一筆一欄位），不經 L1 記憶體快取 → 多台 serverless 同時排除不會互相蓋掉
 *   - 不設 TTL → 不會因為一段時間沒人排除就整批失效
 *   - 寫入／讀取失敗一律丟錯 → 不會「畫面說成功、其實沒存」，比對也不會在讀不到時當作沒有排除
 *   - 「代碼不在開業列表」這一族（歇業候選／從未登錄／同縣市同名／醫院待確認）共用一把鍵 →
 *     同一個代碼換了判定類別也不會重新冒出來
 *
 * 排除只影響顯示與統計，不改客戶主檔。
 */
import { getRedis } from './shared'

export type MonitorDismissCategory =
  | 'closure' | 'codechange' | 'hospital' | 'inconsistent' | 'invalidcode' | 'samecity' | 'unregistered' | 'reopen'

export type MonitorDismissEntry = {
  key: string
  category: MonitorDismissCategory
  customerId: string
  customerName: string
  institutionCode: string
  reason: string
  by: string
  at: string
}

const HASH_KEY = 'medical-monitor:dismissed-v2'   // hash：field=排除鍵，value=MonitorDismissEntry
const LEGACY_KEY = 'medical-monitor:dismissed-v1' // 舊版整包陣列（有 TTL、會互蓋），首次讀取時搬入 v2

/** 同一個「代碼不在開業列表」事實的不同判定 → 視為同一族，排除一次全部生效 */
const FAMILY: Record<MonitorDismissCategory, string> = {
  closure: 'missing', unregistered: 'missing', samecity: 'missing', hospital: 'missing',
  codechange: 'codechange', inconsistent: 'inconsistent', invalidcode: 'invalidcode', reopen: 'reopen',
}

export function dismissKeyOf(category: MonitorDismissCategory, customerId: string, institutionCode: string) {
  return `${FAMILY[category] ?? category}:${customerId.replace(/-/g, '')}:${(institutionCode ?? '').trim() || '-'}`
}

function redisOrThrow() {
  const r = getRedis()
  if (!r) throw new Error('Redis 未設定，無法讀寫排除清單')
  return r
}

/**
 * 舊版陣列 → v2 hash。只要舊鍵還在就搬（不以 hash 是否為空判斷——部署後若先有人排除新項目，
 * hash 已非空，舊紀錄就永遠搬不過去）。用 hsetnx：不覆蓋搬遷前後已寫入的新紀錄。
 */
async function migrateLegacy(): Promise<void> {
  const r = redisOrThrow()
  const legacy = await r.get<MonitorDismissEntry[]>(LEGACY_KEY)
  if (legacy === null || legacy === undefined) return
  if (Array.isArray(legacy) && legacy.length) {
    const p = r.pipeline()
    let n = 0
    for (const e of legacy) {
      if (!e?.customerId || !e?.category) continue
      const key = dismissKeyOf(e.category, e.customerId, e.institutionCode)
      p.hsetnx(HASH_KEY, key, { ...e, key }); n++
    }
    if (n) await p.exec()
  }
  await r.del(LEGACY_KEY)
}

/** 讀全部排除紀錄。失敗會丟錯（呼叫端不得當成「沒有排除」）。 */
export async function listDismissed(): Promise<MonitorDismissEntry[]> {
  const r = redisOrThrow()
  await migrateLegacy()
  const all = await r.hgetall<Record<string, MonitorDismissEntry>>(HASH_KEY)
  return Object.values(all ?? {}).filter((e): e is MonitorDismissEntry => !!e && typeof e === 'object' && !!e.key)
}

/** 取排除鍵集合，供比對時過濾（比對路徑只讀，不寫） */
export async function loadDismissedKeys(): Promise<Set<string>> {
  return new Set((await listDismissed()).map((d) => d.key))
}

export async function dismissMonitorItem(entry: Omit<MonitorDismissEntry, 'key' | 'at'>): Promise<MonitorDismissEntry> {
  const r = redisOrThrow()
  const key = dismissKeyOf(entry.category, entry.customerId, entry.institutionCode)
  const record: MonitorDismissEntry = { ...entry, institutionCode: (entry.institutionCode ?? '').trim(), key, at: new Date().toISOString() }
  await r.hset(HASH_KEY, { [key]: record })
  return record
}

export async function restoreMonitorItem(key: string): Promise<void> {
  await redisOrThrow().hdel(HASH_KEY, key)
}
