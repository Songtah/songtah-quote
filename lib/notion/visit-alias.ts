/**
 * lib/notion/visit-alias.ts — 業務慣用稱呼記憶（客情「單位名稱」→ 客戶主檔）
 *
 * 為什麼需要：業務對同一家客戶會一直用同一個叫法——Sam 寫「雲啓」就是雲起牙體技術所、
 * Amy 寫「達爾文」就是豐達牙體技術所、Eason 寫「台北馬偕」就是馬偕紀念醫院。
 * 這些名稱規則推不出來，只能「記住」。
 *
 * 系統原本記不住，原因是：人工確認配對（pending-match）與舊版 auto-link 都會把
 * 「單位名稱」覆寫成主檔全名，業務原本的叫法就此消失，下次同一個叫法又配不到。
 * 時間序回測（每筆只用它之前的紀錄當記憶）：同業務記憶 3,322 次命中、正確率 97.5%，
 * 是所有比對層裡最準的一層。
 *
 * 兩份表，人工優先：
 *   manual  ─ 人在「待確認配對」按下確認時寫入，永遠以人的決定為準
 *   learned ─ 夜間從已關聯的客情紀錄推導（手打名稱還留著的那些），同一個叫法對到兩家以上就不記
 *
 * 鍵：`業務|字根`（同業務）與 `*|字根`（跨業務，只在全體都一致時才有）。
 * 字根用 customerNameStem，所以「雲啓牙體」「雲啓(王老闆)」都會對到同一條記憶。
 *
 * 屬葉領域（只碰客情庫與 Redis）；客戶所在縣市由呼叫端（組合層）傳入，本檔不 import customers。
 */
import {
  getRedisValue, setRedisValue, getCachedValue, setCachedValue,
  notion, DB, normalizeDatabaseId, notionCallWithRetry, getTitle, getSelect,
} from './shared'
import { customerNameStem } from '@/lib/customer-name-match'

export type AliasEntry = { id: string; city: string; name?: string }
type Store = Record<string, AliasEntry>

const MANUAL_KEY = 'visit-alias-manual-v1'
const LEARNED_KEY = 'visit-alias-learned-v1'
const TTL_MS = 400 * 24 * 3600_000
const MEM_TTL = 10 * 60_000

const normId = (id: string) => (id ?? '').replace(/-/g, '')

export function aliasKey(salesperson: string, name: string): string {
  return `${salesperson || '*'}|${customerNameStem(name)}`
}

export async function loadAliases(): Promise<{ manual: Store; learned: Store }> {
  const mem = getCachedValue<{ manual: Store; learned: Store }>('visit-alias-both')
  if (mem) return mem
  const [manual, learned] = await Promise.all([
    getRedisValue<Store>(MANUAL_KEY).catch(() => null),
    getRedisValue<Store>(LEARNED_KEY).catch(() => null),
  ])
  const both = { manual: manual ?? {}, learned: learned ?? {} }
  setCachedValue('visit-alias-both', both, MEM_TTL)
  return both
}

/** 查記憶：同業務（人工 > 推導）→ 跨業務（人工 > 推導）。只回傳記住的客戶，不做任何判斷 */
export function lookupAlias(
  aliases: { manual: Store; learned: Store }, salesperson: string, name: string,
): (AliasEntry & { scope: 'self' | 'all'; source: 'manual' | 'learned' }) | null {
  const stem = customerNameStem(name)
  if (!stem) return null
  const self = `${salesperson}|${stem}`, all = `*|${stem}`
  if (salesperson && aliases.manual[self]) return { ...aliases.manual[self], scope: 'self', source: 'manual' }
  if (salesperson && aliases.learned[self]) return { ...aliases.learned[self], scope: 'self', source: 'learned' }
  if (aliases.manual[all]) return { ...aliases.manual[all], scope: 'all', source: 'manual' }
  if (aliases.learned[all]) return { ...aliases.learned[all], scope: 'all', source: 'learned' }
  return null
}

/**
 * 人工確認時記住這個叫法。在覆寫「單位名稱」之前呼叫，否則叫法就沒了。
 * 跨業務鍵只在尚未有人工記憶、或與既有人工記憶一致時才寫，避免甲業務的叫法蓋掉乙業務的。
 */
export async function rememberAlias(salesperson: string, typedName: string, entry: AliasEntry): Promise<void> {
  const stem = customerNameStem(typedName)
  if (!stem) return
  const manual = (await getRedisValue<Store>(MANUAL_KEY).catch(() => null)) ?? {}
  const clean = { id: normId(entry.id), city: entry.city, name: entry.name ?? '' }
  if (salesperson) manual[`${salesperson}|${stem}`] = clean
  const all = manual[`*|${stem}`]
  if (!all || all.id === clean.id) manual[`*|${stem}`] = clean
  await setRedisValue(MANUAL_KEY, manual, TTL_MS)
  setCachedValue('visit-alias-both', null as any, 1)
}

/**
 * 夜間從已關聯的客情紀錄重推「learned」表。
 * 手打名稱已被覆寫成主檔全名的紀錄也會進來——那等同「全名→自己」，無害。
 * 同一個鍵對到兩家以上一律不記（寧可不記，不可記錯）。
 */
export async function rebuildLearnedAliases(
  cityById: Map<string, string>, nameById: Map<string, string> = new Map(),
): Promise<{ keys: number; conflicts: number }> {
  const votes = new Map<string, Map<string, number>>()
  const vote = (k: string, id: string) => {
    const m = votes.get(k) ?? new Map<string, number>()
    m.set(id, (m.get(id) ?? 0) + 1)
    votes.set(k, m)
  }
  let cursor: string | undefined
  let total = 0
  do {
    const res: any = await notionCallWithRetry('rebuildLearnedAliases', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.visits),
        page_size: 100,
        filter: { property: '🏥 牙科單位資料', relation: { is_not_empty: true } },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) {
      total++
      const id = normId(page.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id ?? '')
      const stem = customerNameStem(getTitle(page, '單位名稱'))
      if (!id || !stem) continue
      const sp = getSelect(page, '業務人員')
      if (sp) vote(`${sp}|${stem}`, id)
      vote(`*|${stem}`, id)
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  if (total >= 9500) console.warn(`rebuildLearnedAliases: 已關聯客情達 ${total} 筆，逼近 Notion 10k 截斷上限，須改分區掃描`)

  const learned: Store = {}
  let conflicts = 0
  for (const [k, m] of Array.from(votes.entries())) {
    if (m.size !== 1) { conflicts++; continue }
    const id = Array.from(m.keys())[0]
    learned[k] = { id, city: cityById.get(id) ?? '', name: nameById.get(id) ?? '' }
  }
  await setRedisValue(LEARNED_KEY, learned, TTL_MS)
  setCachedValue('visit-alias-both', null as any, 1)
  return { keys: Object.keys(learned).length, conflicts }
}
