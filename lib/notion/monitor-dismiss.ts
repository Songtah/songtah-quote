/**
 * lib/notion/monitor-dismiss.ts — 醫事監控「排除異常」清單
 *
 * 有些候選每個月都會再跑出來，但人已經確認過不是問題（例：診所實際仍營業只是 BAS 未更新、
 * 醫院牙科本來就沒登記為牙醫一般科、代碼確定無誤）。這些要能被「略過」，
 * 否則每月比對都得重看一次同一批。
 *
 * 排除鍵刻意包含**當下的機構代碼**：`類別:客戶id:代碼`。
 * 代碼一旦變動（換照、人工補正），鍵就對不上、該筆會自動重新出現——
 * 符合 CLAUDE.md「狀態必須能自己關閉」：排除不是永久埋葬，是針對「這個代碼的這個判定」。
 *
 * 排除只影響顯示與統計，不改客戶主檔。
 */
import { getRedisValue, setRedisValue } from './shared'

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

const KEY = 'medical-monitor:dismissed-v1'
const TTL_MS = 400 * 24 * 3600_000

export function dismissKeyOf(category: MonitorDismissCategory, customerId: string, institutionCode: string) {
  return `${category}:${customerId.replace(/-/g, '')}:${institutionCode || '-'}`
}

export async function listDismissed(): Promise<MonitorDismissEntry[]> {
  return (await getRedisValue<MonitorDismissEntry[]>(KEY).catch(() => null)) ?? []
}

/** 取排除鍵集合，供比對時過濾（比對路徑只讀，不寫） */
export async function loadDismissedKeys(): Promise<Set<string>> {
  return new Set((await listDismissed()).map((d) => d.key))
}

export async function dismissMonitorItem(entry: Omit<MonitorDismissEntry, 'key' | 'at'>): Promise<MonitorDismissEntry> {
  const list = await listDismissed()
  const key = dismissKeyOf(entry.category, entry.customerId, entry.institutionCode)
  const record: MonitorDismissEntry = { ...entry, key, at: new Date().toISOString() }
  const idx = list.findIndex((d) => d.key === key)
  if (idx >= 0) list[idx] = record
  else list.push(record)
  await setRedisValue(KEY, list, TTL_MS)
  return record
}

export async function restoreMonitorItem(key: string): Promise<void> {
  const list = await listDismissed()
  await setRedisValue(KEY, list.filter((d) => d.key !== key), TTL_MS)
}
