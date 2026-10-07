/**
 * lib/bas-cache-index.ts — data/bas-cache.json 的「機構代碼 → BAS 詳細頁座標與狀態」索引
 *
 * bas-cache.json 的 key 是 `BAS_SEQ__ZONE_SEQ`，記錄每家機構「還在開業列表時」抓到的代碼。
 * 有了 BAS_SEQ 就能直接開衛福部詳細頁——對已歇業／停業者也有效（名稱搜尋只回開業機構）。
 * status／statusCheckedAt 由 scripts/clinic-monitor.mjs 的「補查消失機構」步驟寫入。
 *
 * leaf 模組：只讀檔，不 import 任何領域檔。
 */
import { existsSync, readFileSync, statSync } from 'fs'
import path from 'path'

export type BasCacheRow = {
  basSeq: string
  zoneSeq: string
  code: string
  status: string
  /** 空字串＝從未以詳細頁補查過（status 可能還停在當初的「開業」） */
  statusCheckedAt: string
  name: string
  address: string
  kind: string
  detailUrl: string
}

export type BasVerdict = 'closed' | 'suspended' | 'open' | 'unverified'

const DETAIL = 'https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData'
let memo: { mtime: number; byCode: Map<string, BasCacheRow> } | null = null

export function loadBasCacheIndex(): Map<string, BasCacheRow> {
  const p = path.join(process.cwd(), 'data', 'bas-cache.json')
  if (!existsSync(p)) return new Map()
  const mtime = statSync(p).mtimeMs
  if (memo && memo.mtime === mtime) return memo.byCode
  const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>
  const byCode = new Map<string, BasCacheRow>()
  for (const [key, v] of Object.entries(raw)) {
    if (!v?.code) continue
    const [basSeq, zoneSeq] = key.split('__')
    const row: BasCacheRow = {
      basSeq, zoneSeq, code: v.code, status: v.status ?? '', statusCheckedAt: v.statusCheckedAt ?? '',
      name: v.name ?? '', address: v.address ?? '', kind: v.kind ?? '', detailUrl: `${DETAIL}?BAS_SEQ=${basSeq}&ZONE_SEQ=${zoneSeq}`,
    }
    // 同一代碼若有多筆（極少見），保留最近查證過的那筆
    const prev = byCode.get(v.code)
    if (!prev || row.statusCheckedAt > prev.statusCheckedAt) byCode.set(v.code, row)
  }
  memo = { mtime, byCode }
  return byCode
}

/**
 * 只有「以詳細頁補查過」的狀態才算數；未補查者回 unverified，不可拿快取裡的舊「開業」當真。
 */
export function basVerdict(row: BasCacheRow | undefined): BasVerdict {
  if (!row?.statusCheckedAt) return 'unverified'
  if (/歇業|撤銷|註銷|廢止/.test(row.status)) return 'closed'
  if (/停業/.test(row.status)) return 'suspended'
  if (/開業/.test(row.status)) return 'open'
  return 'unverified'
}
