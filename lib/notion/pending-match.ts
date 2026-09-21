/**
 * lib/notion/pending-match.ts — 待確認配對清單（組合層）
 *
 * 客情紀錄沒關聯到客戶主檔時，自動比對只走到「縮到唯一才配」為止（見 lib/customer-name-match）。
 * 剩下的兩種情況不該就這樣消失，也不該讓系統亂猜：
 *   A. 名稱相符多家、脈絡仍分不出來（實測 109 筆）
 *   B. 主檔查無相符名稱（實測 239 筆，多為錯字或主檔真的沒有）
 * 這兩種一律進本清單，由人在客情頁一鍵選擇——**不要求業務打字**（CLAUDE.md 最高原則）。
 *
 * 以「單位名稱 × 業務」分組，不是逐筆列：552 個名稱對應 824 筆紀錄，
 * 確認一次就把同組的紀錄一起補上關聯。
 *
 * 全掃拜訪庫 + 逐名稱查客戶庫很重，一律由夜間排程重算後存 Redis；
 * 請求路徑只讀快取（比照待認領建議）。
 */
import { getRedisValue, setRedisValue, deleteRedisValue, notionCallWithRetry, notion, DB, normalizeDatabaseId, getTitle, getSelect, getDate, getText } from './shared'
import { searchSystemCustomers } from './customers'
import { customerNameStem, pickCustomerMatch, type MatchCandidate } from '@/lib/customer-name-match'
import { loadMatchContext, narrowingFor } from './match-context'

export type PendingMatchCandidate = MatchCandidate & { type?: string; salesperson?: string }

export type PendingMatchGroup = {
  /** 分組鍵：單位名稱|業務 */
  key: string
  name: string
  salesperson: string
  count: number
  firstDate: string
  lastDate: string
  visitIds: string[]
  /** 系統建議（脈絡縮到唯一時才有）；已建議者代表下次自動比對就會配上，列出來供覆核 */
  suggestion: PendingMatchCandidate | null
  reason: string
  candidates: PendingMatchCandidate[]
  kind: 'ambiguous' | 'not-found'
}

const KEY = 'pending-match-v1'
const TTL_MS = 36 * 3600_000
const IGNORED_KEY = 'pending-match-ignored-v1'
const IGNORED_TTL_MS = 180 * 24 * 3600_000
/** 逐名稱查客戶庫，超過這個數量就停——避免夜間排程無限長 */
const MAX_NAMES = 800

async function loadIgnored(): Promise<Set<string>> {
  return new Set((await getRedisValue<string[]>(IGNORED_KEY).catch(() => null)) ?? [])
}

async function saveIgnored(set: Set<string>) {
  await setRedisValue(IGNORED_KEY, Array.from(set), IGNORED_TTL_MS)
}

/** 全掃未關聯的客情紀錄並分組（不含忽略清單） */
export async function computePendingMatches(): Promise<PendingMatchGroup[]> {
  if (!DB.visits) return []
  type Row = { id: string; name: string; sp: string; date: string }
  const rows: Row[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('computePendingMatches', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        filter: { property: '🏥 牙科單位資料', relation: { is_empty: true } },
        sorts: [{ property: '日期', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      const name = getTitle(page, '單位名稱').trim()
      if (!name) continue
      rows.push({
        id: page.id,
        name,
        sp: getSelect(page, '業務人員'),
        date: getDate(page, '日期'),
      })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  const grouped = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.name}|${r.sp}`
    const list = grouped.get(key) ?? []
    list.push(r)
    grouped.set(key, list)
  }

  const ctx = await loadMatchContext({ allowRebuild: true })
  const ignored = await loadIgnored()
  // 筆數多的先處理：排程若被時限砍掉，至少先解決影響最大的
  const keys = Array.from(grouped.entries())
    .filter(([key]) => !ignored.has(key))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_NAMES)

  const out: PendingMatchGroup[] = []
  for (const [key, list] of keys) {
    const { name, sp } = { name: list[0].name, sp: list[0].sp }
    let candidates = await searchSystemCustomers(name).catch(() => [])
    const stem = customerNameStem(name)
    if (candidates.length === 0 && stem && stem !== name) {
      candidates = await searchSystemCustomers(stem).catch(() => [])
    }
    const picked = pickCustomerMatch(name, candidates, narrowingFor(ctx, sp))
    const dates = list.map((r) => r.date).filter(Boolean).sort()
    out.push({
      key,
      name,
      salesperson: sp,
      count: list.length,
      firstDate: dates[0] ?? '',
      lastDate: dates[dates.length - 1] ?? '',
      visitIds: list.map((r) => r.id),
      suggestion: picked.match ?? null,
      reason: picked.reason,
      candidates: picked.candidates.slice(0, 8),
      kind: picked.candidates.length > 0 ? 'ambiguous' : 'not-found',
    })
  }

  await setRedisValue(KEY, out, TTL_MS)
  return out
}

/** 讀快取；沒有快取時回 null（讓 UI 顯示「尚未產生，請重算」而不是卡住） */
export async function getPendingMatches(): Promise<PendingMatchGroup[] | null> {
  return await getRedisValue<PendingMatchGroup[]>(KEY).catch(() => null)
}

export async function invalidatePendingMatches() {
  try { deleteRedisValue(KEY) } catch { /* 失效失敗下次仍會過期 */ }
}

/** 確認配對：把該組所有客情紀錄關聯到指定客戶，並把單位名稱補齊為主檔全名 */
export async function confirmPendingMatch(input: { visitIds: string[]; customerId: string }): Promise<{ updated: number }> {
  const page: any = await notionCallWithRetry('confirmPendingMatch:customer', () =>
    notion.pages.retrieve({ page_id: input.customerId })
  )
  const customersDb = normalizeDatabaseId(DB.customers!).replace(/-/g, '')
  if ((page?.parent?.database_id ?? '').replace(/-/g, '') !== customersDb) {
    throw new Error('指定的不是客戶主檔頁面')
  }
  const fullName = getTitle(page, '客戶名稱') || getText(page, '客戶名稱')
  let updated = 0
  for (const id of input.visitIds) {
    await notionCallWithRetry('confirmPendingMatch:visit', () =>
      notion.pages.update({
        page_id: id,
        properties: {
          '🏥 牙科單位資料': { relation: [{ id: input.customerId }] },
          ...(fullName ? { '單位名稱': { title: [{ text: { content: fullName } }] } } : {}),
        } as any,
      })
    )
    updated++
  }
  // 清掉快取裡這一組，下次讀取就不會再出現
  const cached = await getPendingMatches()
  if (cached) {
    const left = cached.filter((g) => !g.visitIds.some((v) => input.visitIds.includes(v)))
    await setRedisValue(KEY, left, TTL_MS)
  }
  return { updated }
}

/** 忽略：這組確定不該配對（例：公司內部事項、已歇業），下次重算也不再列出 */
export async function ignorePendingMatch(key: string): Promise<void> {
  const set = await loadIgnored()
  set.add(key)
  await saveIgnored(set)
  const cached = await getPendingMatches()
  if (cached) await setRedisValue(KEY, cached.filter((g) => g.key !== key), TTL_MS)
}

export async function unignorePendingMatch(key: string): Promise<void> {
  const set = await loadIgnored()
  set.delete(key)
  await saveIgnored(set)
}

export async function listIgnoredKeys(): Promise<string[]> {
  return Array.from(await loadIgnored())
}
