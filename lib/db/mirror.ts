/**
 * lib/db/mirror.ts — 寫入 Notion 後立即鏡像到資料庫（讀寫一致，不等 15 分鐘增量同步）
 * 失敗只記 log 不丟錯：Notion 已寫成功，增量同步最晚 15 分鐘內會補齊。
 */
import { sql } from './client'
import { readFromDb } from './read-source'
import { mapCustomer, mapVisit } from './sync-notion'

const setClause = (cols: string[], skip: string[] = []) =>
  cols.filter((c) => c !== 'notion_page_id' && !skip.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ')

export async function mirrorCustomerPage(page: any): Promise<void> {
  if (!readFromDb() || !page?.id || page.archived) return
  try {
    const row = mapCustomer(page)
    const cols = Object.keys(row)
    const db = sql()
    await db`insert into customers ${(db as any)([row], ...cols)} on conflict (notion_page_id) do update set ${db.unsafe(setClause(cols))}`
  } catch (e) {
    console.warn('[db-mirror] customer upsert failed（增量同步會補）:', (e as Error).message)
  }
}

export async function mirrorVisitPage(page: any): Promise<void> {
  if (!readFromDb() || !page?.id) return
  try {
    const db = sql()
    if (page.archived) { await db`delete from visits where notion_page_id = ${page.id}`; return }
    const v = mapVisit(page)
    let customer_id: number | null = null
    if (v.customer_notion_id) {
      const r = await db`select id from customers where notion_page_id = ${v.customer_notion_id}`
      customer_id = r[0]?.id ?? null
    }
    const row = { ...v, customer_id }
    const cols = Object.keys(row)
    await db`insert into visits ${(db as any)([row], ...cols)} on conflict (notion_page_id) do update set ${db.unsafe(setClause(cols, ['customer_id']))}, "customer_id" = coalesce(excluded."customer_id", visits."customer_id")`
  } catch (e) {
    console.warn('[db-mirror] visit upsert failed（增量同步會補）:', (e as Error).message)
  }
}

export async function mirrorVisitArchived(pageId: string): Promise<void> {
  if (!readFromDb() || !pageId) return
  try { await sql()`delete from visits where notion_page_id = ${pageId}` }
  catch (e) { console.warn('[db-mirror] visit delete failed:', (e as Error).message) }
}

export async function mirrorCustomerArchived(pageId: string): Promise<void> {
  if (!readFromDb() || !pageId) return
  try { await sql()`delete from customers where notion_page_id = ${pageId}` }
  catch (e) { console.warn('[db-mirror] customer delete failed:', (e as Error).message) }
}
