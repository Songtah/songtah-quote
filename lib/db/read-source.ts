/**
 * lib/db/read-source.ts — 客戶主檔／客情紀錄的資料來源
 *
 * 2026-11-10 起資料只在 Supabase，Notion 已全部封存。舊的退回開關（DATA_READ_SOURCE／VISITS_SOURCE／
 * CUSTOMERS_SOURCE=notion）已移除：退回只會讀到封存前的舊資料，而且讀寫 Notion 的路徑已一律報錯。
 * 只有本機沒設 DATABASE_URL 時這些函式才會回 false（此時相關功能無法使用）。
 */
import { hasDb } from './client'

export function readFromDb(): boolean { return hasDb() }
export function visitsInDb(): boolean { return hasDb() }
export function customersInDb(): boolean { return hasDb() }

/** Notion 頁面 id 去連字號（兩種寫法在系統內並存） */
export const bareId = (id: string) => (id ?? '').replace(/-/g, '').toLowerCase()
