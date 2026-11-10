/**
 * lib/db/read-source.ts — 客戶主檔／客情紀錄的讀取來源開關
 *
 * 2026-11-10 起預設從 Supabase 讀（搬遷第三步）。
 * 退回方式：環境變數 DATA_READ_SOURCE=notion 並重新部署，所有讀取立刻回到 Notion，資料不受影響。
 * 寫入仍先進 Notion（其他 6 個 Notion 庫關聯著客戶），寫完立即鏡像到資料庫（lib/db/mirror.ts）。
 */
import { hasDb } from './client'

export function readFromDb(): boolean {
  if (process.env.DATA_READ_SOURCE === 'notion') return false
  return hasDb()
}

/**
 * 客情紀錄是否以資料庫為唯一來源（2026-11-10 起預設是；Notion 客情庫已封存、不再寫入）。
 * 退回：VISITS_SOURCE=notion 並重新部署；但系統產生的客情（origin='db'）要先用 scripts/db-visits-backfill-notion.mjs 回填 Notion。
 */
export function visitsInDb(): boolean {
  if (process.env.VISITS_SOURCE === 'notion') return false
  return hasDb()
}

/** Notion 頁面 id 去連字號（兩種寫法在系統內並存） */
export const bareId = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
